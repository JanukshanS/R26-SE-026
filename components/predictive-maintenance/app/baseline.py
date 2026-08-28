"""Used-vehicle baselines: what condition was this car in before we saw it?

THE PROBLEM
-----------
A driver could only register a car as if it left the factory yesterday.
`total_mileage_km` was recomputed per request as the sum of trip distances, so a
141,000 km car that recorded one 20 km trip looked like a 20 km car - and that
column is fed POSITIONALLY to the tyre model, where in training it means the
odometer of a vehicle that started at 0 (generate_training_data.py). Summing
app-recorded trips was correct by accident for a car bought new and simply wrong
for a used one.

THE APPROACH
------------
Two facts per vehicle:

  * a baseline odometer, so total_mileage_km means the real reading
  * per-component install points, so "km on THIS part" is knowable

When the driver does not know when a part was last replaced, infer it by
assuming the car was serviced on schedule - see infer_install_km.

Engine is deliberately excluded from the wear model: engines are not replaced on
a schedule and there is no meaningful "engine install km", so engine health stays
sensor-driven (coolant temp, fuel-trim drift, RPM). Engine OIL is tracked
separately on its own interval, which is the actionable thing for a driver.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import ComponentHealthFloor, ServiceRecord, TripMetrics, VehicleBaseline

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Expected life per component. These were already the health denominator
# (predict.py's COMPONENT_MAX_LIFESPAN_KM) and they are also the moderate-driver
# expectation the models were trained against - compare COMPONENT_LIFETIMES
# ["moderate"] in generate_training_data.py: engine 140-180k, brake 32-48k,
# tire 38-52k, battery 65-90k. Every value below sits inside its band.
#
# Using the same numbers for inference AND for the health denominator is
# deliberate: it makes the inferred baseline and the resulting health agree by
# construction, instead of two nearly-equal constants drifting apart.
COMPONENT_EXPECTED_LIFE_KM: Dict[str, int] = {
    "engine": 150_000,
    "brake": 40_000,
    "tire": 50_000,
    "battery": 80_000,
}

# Components whose health is driven by mileage-since-install. Engine is absent
# on purpose (see module docstring).
WEAR_COMPONENTS = ("brake", "tire", "battery")

# Engine oil is a service interval, not a component lifespan. Tracked from
# `oil_change` service records and surfaced separately from engine condition.
ENGINE_OIL_INTERVAL_KM = 5_000

# Mirrors SERVICE_TYPE_RESETS_WINDOW in apps/mobile/lib/maintenanceApi.ts.
# A type "resets the window" when it puts a NEW part in, so km-on-component
# restarts. `initial_reading` is here because a used-car baseline is exactly
# that: a statement of where the current part's window starts.
SERVICE_TYPE_RESETS_WINDOW: Dict[str, bool] = {
    "replacement": True,
    "initial_reading": True,
    "oil_change": False,
    "rotation": False,
    "inspection": False,
    "service": False,
    "full_service": False,
    "paint": False,
    "system_fix": False,
    "new_implementation": False,
}

# Largest total_mileage_km in data/rul_training_dataset.csv. Above this the tyre
# model is extrapolating: Random Forest saturates at its training max and gives a
# confidently flat answer. Clamp what the MODEL sees; never clamp what we store
# or show.
TIRE_MILEAGE_TRAINING_MAX_KM = 150_029.0

# Below this much recorded driving, the behaviour averages move a lot with every
# new trip: with 6 km logged, one quiet trip can shift the whole picture. The
# number is still shown - hiding it would be worse - but flagged as provisional
# so nobody reads an early reading as settled.
#
# NOTE this is about TOTAL distance, not trip length. Short trips are perfectly
# valid data: someone driving 800 m twice a day still accumulates real wear, and
# short-hop driving is actually harder on an engine than long runs. The rates are
# pooled as (total events / total km), so trip length does not distort them.
MIN_DISTANCE_FOR_CONFIDENCE_KM = 50.0


# ---------------------------------------------------------------------------
# The inference
# ---------------------------------------------------------------------------

def infer_install_km(odometer_km: float, expected_life_km: float) -> Tuple[float, float, str]:
    """Guess when a component was last replaced, from the odometer alone.

    Returns (install_km, km_on_component, basis).

    The assumption is "serviced on schedule": a car at 141,000 km with a 50,000
    km tyre life has had tyres fitted at 50k and 100k, so the current set has
    41,000 km on it and roughly 9,000 left.

    Deliberately the AVERAGE case, never the optimistic one. A guess that says
    "nearly new" about a worn part is the failure mode that gets somebody hurt;
    a guess that says "due soon" about a good part costs an unnecessary check.
    """
    if expected_life_km <= 0:
        # Cannot divide. Report it rather than inventing a number - the caller
        # must not render a health percentage from this.
        return 0.0, max(odometer_km, 0.0), "unknown"

    if odometer_km <= 0:
        return 0.0, 0.0, "inferred_original"

    if expected_life_km >= odometer_km:
        # The part has never been due, so it is still the factory-fitted one.
        return 0.0, odometer_km, "inferred_original"

    n = math.floor(odometer_km / expected_life_km)
    install_km = n * expected_life_km
    km_on = odometer_km - install_km

    if km_on == 0.0:
        # Exact multiple (odometer 100,000 with a 50,000 life). Resolve
        # PESSIMISTICALLY as "due now" rather than "just replaced, 0 km on it":
        # an inferred baseline must never invent a brand-new part. This also
        # keeps the function continuous at odometer == expected_life, where the
        # branch above already answers km_on = odometer.
        install_km -= expected_life_km
        km_on = expected_life_km

    return install_km, km_on, "inferred_schedule"


# ---------------------------------------------------------------------------
# Odometer
# ---------------------------------------------------------------------------

def trip_distance_sum(db: Session, vehicle_id: str) -> float:
    total = db.query(func.coalesce(func.sum(TripMetrics.distance_km), 0.0)).filter(
        TripMetrics.vehicle_id == vehicle_id
    ).scalar()
    return float(total or 0.0)


def current_odometer_km(
    db: Session, vehicle_id: str, trips: Optional[List[TripMetrics]] = None
) -> Tuple[float, float, Optional[VehicleBaseline]]:
    """Real odometer, trip total, and the baseline row (None if never set).

    Falls back to the plain trip sum when no baseline exists, so every vehicle
    registered before this feature behaves exactly as it did before. That
    fallback is the whole migration story - there is nothing to backfill.

    `trips`, when supplied, must be every TripMetrics row for this vehicle.
    The health endpoint already fetches that full list for its own feature
    aggregation; passing it here means the SUM is taken from rows already in
    memory instead of asking Postgres the same question a second time in a
    second round trip. Every other caller omits it and gets the original
    single aggregate query, unchanged.
    """
    trip_km = (
        sum(t.distance_km for t in trips) if trips is not None
        else trip_distance_sum(db, vehicle_id)
    )
    baseline = db.query(VehicleBaseline).filter(
        VehicleBaseline.vehicle_id == vehicle_id
    ).first()
    if baseline is None:
        return trip_km, trip_km, None

    odometer = baseline.baseline_odometer_km + (trip_km - baseline.trip_km_at_baseline)
    # A driver who corrects their odometer downward should not produce a
    # negative reading through arithmetic.
    return max(odometer, 0.0), trip_km, baseline


# ---------------------------------------------------------------------------
# Per-component state
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ComponentState:
    component: str
    install_km: float
    km_on_component: float
    expected_life_km: float
    wear_rul_km: float
    basis: str

    @property
    def is_estimated(self) -> bool:
        return self.basis != "user"


def latest_resetting_records(db: Session, vehicle_id: str) -> Dict[str, ServiceRecord]:
    """Most recent record that PUT A NEW PART IN, for every wear component at once.

    Deliberately different from the /services/latest route, which returns the
    latest record of ANY type (that is what a "last serviced" list wants). Wear
    only restarts on a resetting type, so health must ask a narrower question.
    Do not "fix" one of these to match the other.

    ONE query for all of WEAR_COMPONENTS rather than one per component. This is
    correct, not just faster, because of how the ordering composes: every row
    for every component is fetched under a single global ORDER BY (odometer
    desc, date desc, created desc), and a component's own rows keep their
    relative order within that larger sequence - so the first row seen for a
    given component while walking the results IS that component's maximum,
    exactly as three separate per-component queries would have found.
    Ordered by odometer first because that is the physically meaningful axis -
    a driver can and does type the wrong date.
    """
    resetting = [t for t, resets in SERVICE_TYPE_RESETS_WINDOW.items() if resets]
    rows = (
        db.query(ServiceRecord)
        .filter(
            ServiceRecord.vehicle_id == vehicle_id,
            ServiceRecord.component.in_(WEAR_COMPONENTS),
            ServiceRecord.service_type.in_(resetting),
        )
        .order_by(
            ServiceRecord.odometer_km_at_service.desc(),
            ServiceRecord.service_date.desc(),
            ServiceRecord.created_at.desc(),
        )
        .all()
    )
    latest: Dict[str, ServiceRecord] = {}
    for row in rows:
        latest.setdefault(row.component, row)
    return latest


def resolve_component_states(
    db: Session,
    vehicle_id: str,
    odometer_km: float,
    baseline: Optional[VehicleBaseline],
) -> Dict[str, ComponentState]:
    """Per-component install point, from records first and inference second.

    Resolution order per component:
      1. latest resetting service record  -> basis from the row
      2. baseline.condition == "used"     -> infer from (odometer, expected life)
      3. baseline.condition == "new"      -> install_km = 0 (bought new)
      4. no baseline at all               -> {} , caller stays on model-only RUL

    Step 2 runs at REQUEST time, not only at registration. That is deliberate:
    the inference is a pure function of (odometer, expected life), so a
    registration whose service-record writes partly failed still produces the
    same answer. The stored rows are an audit trail and a correction surface,
    not a correctness requirement - which matters because those writes cross a
    datastore boundary with no transaction.
    """
    if baseline is None:
        return {}

    latest_records = latest_resetting_records(db, vehicle_id)
    states: Dict[str, ComponentState] = {}
    for component in WEAR_COMPONENTS:
        life = float(COMPONENT_EXPECTED_LIFE_KM[component])

        record = latest_records.get(component)
        if record is not None:
            install_km = record.install_km
            km_on = max(odometer_km - install_km, 0.0)
            basis = record.basis
        elif baseline.condition == "used":
            install_km, km_on, basis = infer_install_km(odometer_km, life)
        else:
            install_km, km_on, basis = 0.0, max(odometer_km, 0.0), "user"

        states[component] = ComponentState(
            component=component,
            install_km=install_km,
            km_on_component=km_on,
            expected_life_km=life,
            wear_rul_km=max(life - km_on, 0.0),
            basis=basis,
        )
    return states


# ---------------------------------------------------------------------------
# Engine oil
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EngineOilState:
    km_since_change: Optional[float]
    interval_km: int
    is_overdue: bool
    last_change_odometer_km: Optional[float]

    @property
    def km_remaining(self) -> Optional[float]:
        if self.km_since_change is None:
            return None
        return max(self.interval_km - self.km_since_change, 0.0)


def engine_oil_state(db: Session, vehicle_id: str, odometer_km: float) -> EngineOilState:
    """Oil is an interval, not a lifespan, so it gets its own answer.

    Returns km_since_change=None when no oil change has ever been logged - the
    UI must say "not recorded" rather than implying the oil is fresh.
    """
    record = (
        db.query(ServiceRecord)
        .filter(
            ServiceRecord.vehicle_id == vehicle_id,
            ServiceRecord.service_type == "oil_change",
        )
        .order_by(
            ServiceRecord.odometer_km_at_service.desc(),
            ServiceRecord.created_at.desc(),
        )
        .first()
    )
    if record is None:
        return EngineOilState(None, ENGINE_OIL_INTERVAL_KM, False, None)

    since = max(odometer_km - record.odometer_km_at_service, 0.0)
    return EngineOilState(
        km_since_change=since,
        interval_km=ENGINE_OIL_INTERVAL_KM,
        is_overdue=since >= ENGINE_OIL_INTERVAL_KM,
        last_change_odometer_km=record.odometer_km_at_service,
    )


# ---------------------------------------------------------------------------
# Health floor - health must never rise on its own
# ---------------------------------------------------------------------------

def load_health_floors(db: Session, vehicle_id: str) -> Dict[str, ComponentHealthFloor]:
    """Every component's floor row for one vehicle, in a single query.

    A health check clamps up to four components (engine, brake, tire,
    battery) against their worst-ever reading. Fetching each floor
    individually inside that loop was one round trip per component; this is
    one round trip total, keyed for apply_health_floor to look up in memory.
    """
    rows = (
        db.query(ComponentHealthFloor)
        .filter(ComponentHealthFloor.vehicle_id == vehicle_id)
        .all()
    )
    return {row.component: row for row in rows}


def apply_health_floor(
    floors: Dict[str, ComponentHealthFloor],
    db: Session,
    vehicle_id: str,
    component: str,
    health_pct: float,
    rul_km: float,
) -> Tuple[float, float, bool]:
    """Clamp health to the worst value ever seen, and record new worsts.

    Returns (health_pct, rul_km, was_clamped).

    Without this, health is a read-out of recent driving style rather than of
    accumulated wear, so a gentle week makes worn brake pads look better. The
    only thing that legitimately raises health is fitting a new part, which
    clears the floor via clear_health_floor.

    `floors` comes from load_health_floors, called ONCE before the caller's
    per-component loop - not queried again here. A new floor row is staged
    with db.add() and an existing one is mutated in place, but NEITHER is
    committed: committing once per component, up to four times per health
    check, was the more expensive half of the original round-trip count
    (a commit forces a transaction sync; a plain select does not). The
    caller commits once after every component has been processed. Because
    this mutates `floors` and calls db.add() for a new row, calling it twice
    for the same component before that commit would see the first call's
    staged row on the second call rather than issuing a duplicate insert -
    which cannot happen in practice, since predict.py calls this exactly once
    per component per request.
    """
    now = datetime.now(timezone.utc).isoformat()
    row = floors.get(component)

    if row is None:
        new_row = ComponentHealthFloor(
            vehicle_id=vehicle_id, component=component,
            health_pct=health_pct, rul_km=rul_km, observed_at=now,
        )
        db.add(new_row)
        floors[component] = new_row
        return health_pct, rul_km, False

    if health_pct < row.health_pct:
        row.health_pct = health_pct
        row.rul_km = rul_km
        row.observed_at = now
        return health_pct, rul_km, False

    # Today looks better than the worst we have seen. Report the worst.
    return row.health_pct, row.rul_km, True


def clear_health_floor(db: Session, vehicle_id: str, component: str) -> None:
    """A new part really does reset wear, so the old floor no longer applies."""
    db.query(ComponentHealthFloor).filter(
        ComponentHealthFloor.vehicle_id == vehicle_id,
        ComponentHealthFloor.component == component,
    ).delete()
    db.commit()
