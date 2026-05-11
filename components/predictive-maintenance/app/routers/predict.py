from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TripMetrics
from app.schemas import ComponentHealth, ComponentRUL, PredictionRequest, PredictionResponse, VehicleHealthResponse, VehicleRULResponse

router = APIRouter()

# Feature columns required by each component model (must match train_models.py)
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


@router.get("/vehicle/{vehicle_id}/health", response_model=VehicleHealthResponse)
def vehicle_health(
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
    total_mileage = float(weights.sum())

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

        X = np.array([[aggregated[f] for f in features]])
        rul_km = round(max(float(model.predict(X)[0]), 0.0), 1)

        health_pct = round(min(rul_km / max_km * 100, 100.0), 1)
        health_scores.append(health_pct)

        components.append(
            ComponentHealth(
                component=COMPONENT_LABELS[component],
                health_pct=health_pct,
                status=_health_status(health_pct),
                predicted_rul_km=rul_km,
                max_lifespan_km=max_km,
                confidence_note=f"{algo_label} (R²={r2_score:.4f})",
            )
        )

    overall_pct = round(float(np.mean(health_scores)), 1)

    return VehicleHealthResponse(
        vehicle_id=vehicle_id,
        overall_health_pct=overall_pct,
        overall_status=_health_status(overall_pct),
        trip_count=len(trips),
        total_mileage_km=round(total_mileage, 2),
        components=components,
        timestamp=datetime.now(timezone.utc).isoformat(),
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
