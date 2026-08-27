from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.controllers.fault_controller import history
from app.controllers.fault_presenter import sort_faults, to_out
from app.database import get_db
from app.models import TripMetrics
from app.baseline import (
    MIN_DISTANCE_FOR_CONFIDENCE_KM,
    TIRE_MILEAGE_TRAINING_MAX_KM,
    apply_health_floor,
    current_odometer_km,
    engine_oil_state,
    load_health_floors,
    resolve_component_states,
)
from app.schemas import (
    ComponentHealth,
    ComponentRUL,
    EngineOilStatus,
    PredictionRequest,
    PredictionResponse,
    VehicleHealthResponse,
    VehicleRULResponse,
)

router = APIRouter()

# Feature columns required by each component model (must match train_models.py)
# How far a part has to run after a logged replacement before the
# behaviour-based model term is trusted again. Below this, health.py reports
# the wear reading alone - see the REPLACEMENT_GRACE_KM branch below for why.
REPLACEMENT_GRACE_KM = 500.0

COMPONENT_FEATURE_MAP: Dict[str, List[str]] = {
    "engine": ["avg_rpm", "max_coolant_temp_c", "ltft_std"],
    "brake": ["braking_frequency", "avg_deceleration_intensity"],
    "tire": ["cornering_frequency", "avg_speed_kmh", "total_mileage_km"],
    "battery": ["voltage_std", "min_battery_voltage_v", "avg_iat_c"],
}

COMPONENT_LABELS = {
    "engine": "Engine",
    "brake": "Brake Pads",
    "tire": "Tires",
    "battery": "Battery",
}


def _get_models(request: Request) -> Optional[Dict]:
    return getattr(request.app.state, "models", None)


def _predict(
    prediction_request: PredictionRequest,
    algo_suffix: str,
    app_request: Request,
) -> PredictionResponse:
    models = _get_models(app_request)
    if not models:
        raise HTTPException(
            status_code=503,
            detail="Models not loaded. Run train_models.py first, then restart the server.",
        )

    algo_label = "Random Forest" if algo_suffix == "rf" else "Gradient Boosting"
    req_dict = prediction_request.model_dump()

    results: List[ComponentRUL] = []
    for component, features in COMPONENT_FEATURE_MAP.items():
        model_key = f"{component}_{algo_suffix}"
        model = models.get(model_key)
        if model is None:
            raise HTTPException(
                status_code=503,
                detail=f"Model '{model_key}' not found. Run train_models.py first.",
            )
        X = np.array([[req_dict[f] for f in features]])
        rul_km = float(model.predict(X)[0])
        results.append(
            ComponentRUL(
                component=COMPONENT_LABELS[component],
                predicted_rul_km=round(max(rul_km, 0.0), 1),
                confidence_note=f"{algo_label} model",
            )
        )

    return PredictionResponse(
        vehicle_id=prediction_request.vehicle_id,
        algorithm="random_forest" if algo_suffix == "rf" else "gradient_boosting",
        predictions=results,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/predict/rf", response_model=PredictionResponse)
def predict_random_forest(body: PredictionRequest, request: Request) -> PredictionResponse:
    """Predict RUL for all four components using the Random Forest models."""
    return _predict(body, "rf", request)


@router.post("/predict/gb", response_model=PredictionResponse)
def predict_gradient_boosting(body: PredictionRequest, request: Request) -> PredictionResponse:
    """Predict RUL for all four components using the Gradient Boosting (XGBoost) models."""
    return _predict(body, "gb", request)


# Max expected lifespan per component (moderate-driver baseline, used to normalise RUL → health %)
COMPONENT_MAX_LIFESPAN_KM: Dict[str, int] = {
    "engine":  150_000,
    "brake":    40_000,
    "tire":     50_000,
    "battery":  80_000,
}


def _health_status(pct: float) -> str:
    if pct >= 75:
        return "Good"
    if pct >= 50:
        return "Fair"
    if pct >= 25:
        return "Poor"
    return "Critical"


# Display label -> the short key the rest of the app uses. Faults are stored
# against the short key; the health response speaks in labels.
_LABEL_TO_KEY = {"Engine": "engine", "Brake Pads": "brake", "Tires": "tire", "Battery": "battery"}


@router.get("/vehicle/{vehicle_id}/health", response_model=VehicleHealthResponse)
def vehicle_health(
    vehicle_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> VehicleHealthResponse:
    """Wear health, with any live trouble codes attached.

    The wear computation is untouched and lives in _vehicle_health_wear below.
    Faults are joined on here, in ONE place, because that function has three
    separate return points and a fault list attached to only two of them is
    exactly the kind of gap nobody notices until a driver with no baseline
    reports that their dashboard light is missing from the app.
    """
    response = _vehicle_health_wear(vehicle_id, request, db)
    try:
        return _attach_faults(db, vehicle_id, response)
    except Exception as exc:  # noqa: BLE001
        # Diagnostics are additive. If anything here fails the driver still
        # gets their wear health rather than a 500.
        print(f"[predict] could not attach faults for {vehicle_id}: {exc}")
        return response


def _attach_faults(
    db: Session, vehicle_id: str, response: VehicleHealthResponse
) -> VehicleHealthResponse:
    # ONE query instead of two. history() already returns every row for this
    # vehicle - resolved and active - so "has this vehicle ever been scanned"
    # is just "is that list non-empty", and filtering it in Python for the
    # unresolved ones is the same answer active_faults() would have given with
    # its own separate query. The 200-row cap does not change either result:
    # a real vehicle's live fault count is always far below it, and the
    # checked flag only needs to know whether at least one row exists at all.
    rows = history(db, vehicle_id, limit=200)
    all_faults = sort_faults([to_out(r) for r in rows if r.resolved_at is None])

    response.faults = all_faults
    # "Checked" means some trip actually completed a code read. Without this a
    # car whose adapter cannot read codes looks identical to one with none.
    response.faults_checked = bool(rows)

    by_component: dict = {}
    for fault in all_faults:
        by_component.setdefault(fault.component, []).append(fault)

    for component in response.components:
        key = _LABEL_TO_KEY.get(component.component)
        if not key:
            continue
        # WEAR AND FAULTS ARE KEPT SEPARATE, DELIBERATELY.
        #
        # An earlier version escalated component.status here, so a live urgent
        # fault turned a 94%-healthy engine "Critical". That reads as the wear
        # model having changed its mind, which it has not: the engine is still
        # 94% through its life, and a misfire is a defect sitting on top of
        # that, not evidence of wear. Corrupting the one number the model is
        # entitled to state - and which the whole RUL prediction rests on - to
        # carry an unrelated signal made both harder to trust.
        #
        # So status and health_pct stay purely wear-derived, and the fault
        # travels beside them in `faults` for the UI to surface as its own
        # alert. app/advice.py still escalates URGENCY (what to do about it),
        # which is a different question from how worn the part is.
        component.faults = by_component.get(key, [])

    return response


def _vehicle_health_wear(
    vehicle_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> VehicleHealthResponse:
    """
    Aggregate all stored trips for a vehicle, predict RUL per component using
    the best algorithm, then convert each RUL into a health percentage:

        health_pct = (predicted_rul_km / max_lifespan_km) × 100

    Overall health is the average of the four component health scores.

    Status thresholds:
      Good     >= 75%
      Fair     >= 50%
      Poor     >= 25%
      Critical  < 25%
    """
    trips = db.query(TripMetrics).filter(TripMetrics.vehicle_id == vehicle_id).all()

    if not trips:
        # No driving data yet - but a registered used car already knows plenty.
        # Wear is derived from the odometer and the registration baseline, not
        # from trips, so a driver who has just added a 141,000 km car should see
        # honest component health immediately rather than an empty screen.
        odometer_km, recorded_trip_km, baseline = current_odometer_km(db, vehicle_id)
        if baseline is not None:
            states = resolve_component_states(db, vehicle_id, odometer_km, baseline)
            oil = engine_oil_state(db, vehicle_id, odometer_km)
            comps: List[ComponentHealth] = []
            scores: List[float] = []
            for key, label in COMPONENT_LABELS.items():
                state = states.get(key)
                if state is None:
                    # Engine: judged on how it runs, which needs trips.
                    comps.append(ComponentHealth(
                        component=label, health_pct=0.0, status="No data",
                        predicted_rul_km=0.0,
                        max_lifespan_km=COMPONENT_MAX_LIFESPAN_KM[key],
                        confidence_note="Needs a recorded trip to assess",
                    ))
                    continue
                pct = round(min(state.wear_rul_km / state.expected_life_km * 100, 100.0), 1)
                scores.append(pct)
                note = (f"wear-limited ({state.km_on_component:,.0f}/"
                        f"{state.expected_life_km:,.0f} km on part)")
                if state.is_estimated:
                    note = "Estimated baseline - " + note
                comps.append(ComponentHealth(
                    component=label, health_pct=pct, status=_health_status(pct),
                    predicted_rul_km=round(state.wear_rul_km, 1),
                    max_lifespan_km=COMPONENT_MAX_LIFESPAN_KM[key],
                    confidence_note=note,
                    km_on_component=round(state.km_on_component, 1),
                    install_km=round(state.install_km, 1),
                    baseline_basis=state.basis,
                    is_estimated=state.is_estimated,
                    rul_source="wear",
                ))
            overall = round(float(np.mean(scores)), 1) if scores else 0.0
            return VehicleHealthResponse(
                vehicle_id=vehicle_id,
                overall_health_pct=overall,
                overall_status=_health_status(overall) if scores else "No data",
                trip_count=0,
                total_mileage_km=round(odometer_km, 2),
                components=comps,
                timestamp=datetime.now(timezone.utc).isoformat(),
                odometer_km=round(odometer_km, 1),
                baseline_odometer_km=round(baseline.baseline_odometer_km, 1),
                recorded_trip_km=round(recorded_trip_km, 2),
                vehicle_condition=baseline.condition,
                engine_oil=EngineOilStatus(
                    interval_km=oil.interval_km,
                    km_since_change=(round(oil.km_since_change, 1)
                                     if oil.km_since_change is not None else None),
                    km_remaining=(round(oil.km_remaining, 1)
                                  if oil.km_remaining is not None else None),
                    is_overdue=oil.is_overdue,
                    last_change_odometer_km=oil.last_change_odometer_km,
                ),
            )

    if not trips:
        # No trip data yet — return a neutral "no data" health response
        no_data_component = ComponentHealth(
            component="",
            health_pct=0.0,
            status="No data",
            predicted_rul_km=0.0,
            max_lifespan_km=0,
            confidence_note="No trips recorded yet",
        )
        return VehicleHealthResponse(
            vehicle_id=vehicle_id,
            overall_health_pct=0.0,
            overall_status="No data",
            trip_count=0,
            total_mileage_km=0.0,
            components=[
                ComponentHealth(component="Engine",     health_pct=0, status="No data", predicted_rul_km=0, max_lifespan_km=150000, confidence_note="No trips recorded yet"),
                ComponentHealth(component="Brake Pads", health_pct=0, status="No data", predicted_rul_km=0, max_lifespan_km=40000,  confidence_note="No trips recorded yet"),
                ComponentHealth(component="Tires",      health_pct=0, status="No data", predicted_rul_km=0, max_lifespan_km=50000,  confidence_note="No trips recorded yet"),
                ComponentHealth(component="Battery",    health_pct=0, status="No data", predicted_rul_km=0, max_lifespan_km=80000,  confidence_note="No trips recorded yet"),
            ],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    models = _get_models(request)
    if not models:
        raise HTTPException(status_code=503, detail="Models not loaded. Run train_models.py first.")

    best_selection: Dict = getattr(request.app.state, "best_models", {})
    if not best_selection:
        raise HTTPException(status_code=503, detail="best_models.json not found. Run train_models.py first.")

    # Distance-weighted feature averages
    weights = np.array([t.distance_km for t in trips])

    # The REAL odometer, not just what this app has watched. total_mileage_km is
    # fed positionally to the tyre model, and in training that column is the
    # odometer of a vehicle that started at 0 - so summing app-recorded trips
    # told the model "20 km" about a car with 41,000 km on its tyres.
    # trips=trips: this vehicle's full row set was already fetched above, so
    # the odometer's own trip-distance SUM is taken from those rows instead of
    # asking Postgres the same question in a second round trip.
    odometer_km, recorded_trip_km, baseline = current_odometer_km(db, vehicle_id, trips=trips)
    total_mileage = odometer_km
    states = resolve_component_states(db, vehicle_id, odometer_km, baseline)
    oil = engine_oil_state(db, vehicle_id, odometer_km)
    # One query for all four components' floor rows, not one per component -
    # see load_health_floors and apply_health_floor in app/baseline.py.
    floors = load_health_floors(db, vehicle_id)

    def wavg(vals: List[float]) -> float:
        return float(np.average(vals, weights=weights))

    aggregated = {
        "avg_rpm":                    wavg([t.avg_rpm for t in trips]),
        "max_coolant_temp_c":         wavg([t.max_coolant_temp_c for t in trips]),
        "ltft_std":                   wavg([t.ltft_std for t in trips]),
        "braking_frequency":          wavg([t.braking_frequency for t in trips]),
        "avg_deceleration_intensity": wavg([t.avg_deceleration_intensity for t in trips]),
        "cornering_frequency":        wavg([t.cornering_frequency for t in trips]),
        "avg_speed_kmh":              wavg([t.avg_speed_kmh for t in trips]),
        "total_mileage_km":           total_mileage,
        "voltage_std":                wavg([t.voltage_std for t in trips]),
        "min_battery_voltage_v":      wavg([t.min_battery_voltage_v for t in trips]),
        "avg_iat_c":                  wavg([t.avg_iat_c for t in trips]),
    }

    components: List[ComponentHealth] = []
    health_scores: List[float] = []

    for component, features in COMPONENT_FEATURE_MAP.items():
        algo_suffix = best_selection[component]["algorithm"]
        r2_score    = best_selection[component]["r2"]
        algo_label  = "Random Forest" if algo_suffix == "rf" else "Gradient Boosting"
        max_km      = COMPONENT_MAX_LIFESPAN_KM[component]

        model = models.get(f"{component}_{algo_suffix}")
        if model is None:
            raise HTTPException(status_code=503, detail=f"Model '{component}_{algo_suffix}' not found.")

        # Clamp only what the MODEL sees. 150,029 km is the largest
        # total_mileage_km in the training set; above it the Random Forest
        # saturates and returns a confidently flat answer. Never clamp what we
        # store or display.
        feature_values = []
        for f in features:
            v = aggregated[f]
            if f == "total_mileage_km":
                v = min(v, TIRE_MILEAGE_TRAINING_MAX_KM)
            feature_values.append(v)

        X = np.array([feature_values])
        model_rul_km = round(max(float(model.predict(X)[0]), 0.0), 1)

        state = states.get(component)
        if state is None:
            # No baseline, or engine (deliberately sensor-only: engines aren't
            # replaced on a schedule, so "km since install" has no meaning).
            # Byte-identical to the behaviour before wear baselines existed.
            rul_km = model_rul_km
            health_pct = round(min(rul_km / max_km * 100, 100.0), 1)
            note = f"{algo_label} (R²={r2_score:.4f})"
            extra = {}
        elif state.km_on_component < REPLACEMENT_GRACE_KM:
            # A REAL REPLACEMENT MUST VISIBLY HELP.
            #
            # Verified against a live vehicle: logging a brake replacement left
            # health completely unchanged, at the exact same 5.6% as before.
            # The model term is a distance-weighted average of braking_frequency
            # and avg_deceleration_intensity over EVERY trip the vehicle has ever
            # recorded - it has no notion of "since install" and does not reset
            # when a part does. Since min(wear, model) keeps whichever is worse,
            # and the model term was already the bad one, a brand-new part with
            # a 40,000 km wear allowance was still capped at whatever stale,
            # pre-replacement driving history the model remembered.
            #
            # So for a genuinely young part, the model term is not asked at all.
            # It is not that it is being outvoted - it has nothing to say yet: it
            # cannot distinguish "45,000 km on old pads and counting" from
            # "500 km on new ones", because it was never given "km on this part"
            # as an input in the first place.
            #
            # THIS DOES NOT FIX THE MODEL TERM ITSELF - it stays contaminated
            # by the driving history of the part that came off, and once
            # km_on_component crosses the grace window the two terms are
            # blended again exactly as before, which can read as a sudden drop.
            # The real fix is teaching the model term to only look at trips
            # since the part was fitted; this buys time until that lands by
            # making the one thing a driver can directly verify - "I just paid
            # for new pads" - visibly true today.
            rul_km = round(state.wear_rul_km, 1)
            source = "wear"
            health_pct = round(min(rul_km / state.expected_life_km * 100, 100.0), 1)
            note = (
                f"new part ({state.km_on_component:,.0f}/{REPLACEMENT_GRACE_KM:,.0f} km "
                f"since fitted) - sensor reading needs more driving on this part first"
            )
            if state.is_estimated:
                note = "Estimated baseline - " + note
            extra = {
                "km_on_component": round(state.km_on_component, 1),
                "install_km": round(state.install_km, 1),
                "baseline_basis": state.basis,
                "is_estimated": state.is_estimated,
                "rul_source": source,
            }
        else:
            # The wear term is what we KNOW (how far this part has run since it
            # went in); the model term is what the sensors SEE (whether it's
            # degrading faster than mileage alone implies). Whichever says
            # "sooner" wins: an early alert is recoverable, a late one is not.
            rul_km = round(min(state.wear_rul_km, model_rul_km), 1)
            source = "wear" if state.wear_rul_km <= model_rul_km else "model"
            health_pct = round(min(rul_km / state.expected_life_km * 100, 100.0), 1)
            if source == "wear":
                note = (
                    f"wear-limited ({state.km_on_component:,.0f}/"
                    f"{state.expected_life_km:,.0f} km on part)"
                )
                if state.is_estimated:
                    note = "Estimated baseline - " + note
            else:
                note = f"sensor-limited - {algo_label} (R²={r2_score:.4f})"
            extra = {
                "km_on_component": round(state.km_on_component, 1),
                "install_km": round(state.install_km, 1),
                "baseline_basis": state.basis,
                "is_estimated": state.is_estimated,
                "rul_source": source,
            }

        # Parts do not heal. Health used to be a read-out of recent driving
        # style, so a few gentle trips pushed it UP - 56 then 64 then 67 - which
        # told the driver their worn parts had recovered. Clamp to the worst
        # reading ever seen; only fitting a new part clears it.
        # No commit here - see apply_health_floor's docstring. Every component
        # in this loop stages its write into the same `floors` dict and the
        # same session; one commit after the loop covers all of them.
        health_pct, rul_km, clamped = apply_health_floor(
            floors, db, vehicle_id, component, health_pct, rul_km
        )
        if clamped:
            note = note + " - held at the worst reading so far"

        # Early on, a single trip moves the averages a lot. Show the number but
        # say it is still settling rather than letting it read as final.
        if recorded_trip_km < MIN_DISTANCE_FOR_CONFIDENCE_KM:
            note = (
                f"provisional - only {recorded_trip_km:,.0f} km recorded so far; "
                f"settles after about {MIN_DISTANCE_FOR_CONFIDENCE_KM:,.0f} km. "
            ) + note

        health_scores.append(health_pct)

        components.append(
            ComponentHealth(
                component=COMPONENT_LABELS[component],
                health_pct=health_pct,
                status=_health_status(health_pct),
                predicted_rul_km=rul_km,
                max_lifespan_km=max_km,
                confidence_note=note,
                **extra,
            )
        )

    # The one commit for every floor row apply_health_floor staged in the loop
    # above - up to four inserts/updates, one round trip instead of four.
    db.commit()

    overall_pct = round(float(np.mean(health_scores)), 1)

    return VehicleHealthResponse(
        vehicle_id=vehicle_id,
        overall_health_pct=overall_pct,
        overall_status=_health_status(overall_pct),
        trip_count=len(trips),
        total_mileage_km=round(total_mileage, 2),
        components=components,
        timestamp=datetime.now(timezone.utc).isoformat(),
        odometer_km=round(odometer_km, 1),
        baseline_odometer_km=(
            round(baseline.baseline_odometer_km, 1) if baseline is not None else None
        ),
        recorded_trip_km=round(recorded_trip_km, 2),
        is_provisional=recorded_trip_km < MIN_DISTANCE_FOR_CONFIDENCE_KM,
        min_distance_for_confidence_km=MIN_DISTANCE_FOR_CONFIDENCE_KM,
        vehicle_condition=baseline.condition if baseline is not None else None,
        engine_oil=EngineOilStatus(
            interval_km=oil.interval_km,
            km_since_change=(
                round(oil.km_since_change, 1) if oil.km_since_change is not None else None
            ),
            km_remaining=(
                round(oil.km_remaining, 1) if oil.km_remaining is not None else None
            ),
            is_overdue=oil.is_overdue,
            last_change_odometer_km=oil.last_change_odometer_km,
        ),
    )


@router.get("/models/metrics")
def model_metrics(request: Request) -> Dict:
    """
    Return accuracy metrics (R², RMSE, MAE) for all 8 trained models.

    Metrics are computed on a held-out 20% test set during training and saved
    to models/metrics.json.  Re-run train_models.py to refresh them.

    Metric guide:
      R²   — Proportion of variance explained. 1.0 = perfect, 0.0 = no better than mean.
      RMSE — Root Mean Squared Error in km. Penalises large errors more than MAE.
      MAE  — Mean Absolute Error in km. Average prediction error you can expect.
    """
    metrics = getattr(request.app.state, "metrics", {})
    if not metrics:
        raise HTTPException(
            status_code=503,
            detail="metrics.json not found. Run train_models.py then restart the server.",
        )
    return metrics


@router.get("/vehicle/{vehicle_id}/rul", response_model=VehicleRULResponse)
def vehicle_rul(
    vehicle_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> VehicleRULResponse:
    """
    Aggregate all stored trip metrics for a vehicle, compute feature averages,
    and return RUL predictions using the best algorithm per component.

    - All features are weighted by trip distance so longer trips carry more weight.
    - total_mileage_km is the cumulative sum of all trip distances (odometer proxy).
    """
    trips = db.query(TripMetrics).filter(TripMetrics.vehicle_id == vehicle_id).all()
    if not trips:
        raise HTTPException(
            status_code=404,
            detail=f"No trips found for vehicle '{vehicle_id}'.",
        )

    models = _get_models(request)
    if not models:
        raise HTTPException(status_code=503, detail="Models not loaded. Run train_models.py first.")

    best_selection: Dict = getattr(request.app.state, "best_models", {})
    if not best_selection:
        raise HTTPException(status_code=503, detail="best_models.json not found. Run train_models.py first.")

    # Weighted averages by distance so longer trips contribute proportionally more
    weights = np.array([t.distance_km for t in trips])
    total_weight = weights.sum()

    def wavg(vals: List[float]) -> float:
        return float(np.average(vals, weights=weights))

    def wmin(vals: List[float]) -> float:
        # For min_battery_voltage_v: take the distance-weighted average of per-trip minimums
        return float(np.average(vals, weights=weights))

    aggregated = {
        "avg_rpm":                    wavg([t.avg_rpm for t in trips]),
        "max_coolant_temp_c":         wavg([t.max_coolant_temp_c for t in trips]),
        "ltft_std":                   wavg([t.ltft_std for t in trips]),
        "braking_frequency":          wavg([t.braking_frequency for t in trips]),
        "avg_deceleration_intensity": wavg([t.avg_deceleration_intensity for t in trips]),
        "cornering_frequency":        wavg([t.cornering_frequency for t in trips]),
        "avg_speed_kmh":              wavg([t.avg_speed_kmh for t in trips]),
        "total_mileage_km":           float(total_weight),  # cumulative odometer
        "voltage_std":                wavg([t.voltage_std for t in trips]),
        "min_battery_voltage_v":      wmin([t.min_battery_voltage_v for t in trips]),
        "avg_iat_c":                  wavg([t.avg_iat_c for t in trips]),
    }

    results: List[ComponentRUL] = []
    for component, features in COMPONENT_FEATURE_MAP.items():
        algo_suffix = best_selection[component]["algorithm"]
        r2_score    = best_selection[component]["r2"]
        algo_label  = "Random Forest" if algo_suffix == "rf" else "Gradient Boosting"

        model = models.get(f"{component}_{algo_suffix}")
        if model is None:
            raise HTTPException(status_code=503, detail=f"Model '{component}_{algo_suffix}' not found.")

        X = np.array([[aggregated[f] for f in features]])
        rul_km = float(model.predict(X)[0])
        results.append(
            ComponentRUL(
                component=COMPONENT_LABELS[component],
                predicted_rul_km=round(max(rul_km, 0.0), 1),
                confidence_note=f"{algo_label} (R²={r2_score:.4f})",
            )
        )

    return VehicleRULResponse(
        vehicle_id=vehicle_id,
        trip_count=len(trips),
        total_mileage_km=round(float(total_weight), 2),
        algorithm="best_per_component",
        predictions=results,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/predict/best", response_model=PredictionResponse)
def predict_best(body: PredictionRequest, request: Request) -> PredictionResponse:
    """
    Predict RUL using the best-performing algorithm per component.
    The winner for each component is determined automatically during training
    (saved in models/best_models.json) based on R² score on the test set.
    """
    models = _get_models(request)
    if not models:
        raise HTTPException(
            status_code=503,
            detail="Models not loaded. Run train_models.py first, then restart the server.",
        )

    best_selection: Dict = getattr(request.app.state, "best_models", {})
    if not best_selection:
        raise HTTPException(
            status_code=503,
            detail="best_models.json not found. Run train_models.py first, then restart.",
        )

    req_dict = body.model_dump()
    results: List[ComponentRUL] = []

    for component, features in COMPONENT_FEATURE_MAP.items():
        algo_suffix = best_selection[component]["algorithm"]   # "rf" or "gb"
        r2_score    = best_selection[component]["r2"]
        algo_label  = "Random Forest" if algo_suffix == "rf" else "Gradient Boosting"

        model_key = f"{component}_{algo_suffix}"
        model = models.get(model_key)
        if model is None:
            raise HTTPException(
                status_code=503,
                detail=f"Best model '{model_key}' not found. Run train_models.py first.",
            )

        X = np.array([[req_dict[f] for f in features]])
        rul_km = float(model.predict(X)[0])

        results.append(
            ComponentRUL(
                component=COMPONENT_LABELS[component],
                predicted_rul_km=round(max(rul_km, 0.0), 1),
                confidence_note=f"{algo_label} (R²={r2_score:.4f})",
            )
        )

    return PredictionResponse(
        vehicle_id=body.vehicle_id,
        algorithm="best_per_component",
        predictions=results,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
