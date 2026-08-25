"""Service records and vehicle baselines.

These routes have been called by the mobile app since the service-record screens
were written - apps/mobile/lib/maintenanceApi.ts defines logService,
getLatestServices and getServiceHistory, and add-service-record.tsx is wired to
them - but they never existed here, so every call 404'd. The request and response
shapes below match that already-written client contract deliberately; do not
"improve" them without changing the client in the same commit.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.baseline import (
    COMPONENT_EXPECTED_LIFE_KM,
    ENGINE_OIL_INTERVAL_KM,
    SERVICE_TYPE_RESETS_WINDOW,
    WEAR_COMPONENTS,
    clear_health_floor,
    current_odometer_km,
    infer_install_km,
    trip_distance_sum,
)
from app.database import get_db
from app.models import ServiceRecord, VehicleBaseline
from app.schemas import (
    LatestServiceEntry,
    ServiceRecordCreate,
    ServiceRecordOut,
    VehicleBaselineOut,
    VehicleBaselineUpsert,
)

router = APIRouter()

VALID_COMPONENTS = set(COMPONENT_EXPECTED_LIFE_KM) | {"full_service"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assert_owner(db: Session, vehicle_id: str, user_id: str) -> Optional[VehicleBaseline]:
    """Refuse writes to a vehicle owned by somebody else.

    require_user proves *a* user, not *this vehicle's* user, and vehicle_id is a
    guessable plate string. That was tolerable while every route was read-only;
    with two write routes it would let any authenticated account rewrite another
    driver's maintenance history. First writer claims the vehicle.
    """
    baseline = db.query(VehicleBaseline).filter(
        VehicleBaseline.vehicle_id == vehicle_id
    ).first()
    if baseline is not None and baseline.owner_id and baseline.owner_id != user_id:
        raise HTTPException(status_code=403, detail="This vehicle belongs to another account.")
    return baseline


def _to_out(record: ServiceRecord) -> ServiceRecordOut:
    return ServiceRecordOut(
        id=record.id,
        vehicle_id=record.vehicle_id,
        component=record.component,
        service_type=record.service_type,
        service_date=record.service_date,
        created_at=record.created_at,
        km_on_component=record.km_on_component,
        odometer_km_at_service=record.odometer_km_at_service,
        install_km=record.install_km,
        basis=record.basis,
        is_estimated=record.basis != "user",
        resets_window=SERVICE_TYPE_RESETS_WINDOW.get(record.service_type, False),
        expected_life_km_at_estimate=record.expected_life_km_at_estimate,
        item_name=record.item_name,
        is_original=record.is_original,
        garage_name=record.garage_name,
        cost_lkr=record.cost_lkr,
        notes=record.notes,
    )


# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------

@router.put("/vehicle/{vehicle_id}/baseline", response_model=VehicleBaselineOut, status_code=201)
def create_baseline(
    vehicle_id: str,
    body: VehicleBaselineUpsert,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user),
) -> VehicleBaselineOut:
    """Record what the odometer read before this app saw the vehicle.

    Create-only: 409 if this vehicle already has one. See the comment below.
    """
    baseline = _assert_owner(db, vehicle_id, user_id)

    # Set ONCE, at registration, and never again. This is a statement about the
    # vehicle's history at the moment it was registered - "it had done 141,000 km
    # when I added it" - and history does not change. Allowing edits would also
    # let a driver quietly rewrite their maintenance position after the fact,
    # which is exactly what the wear calculation must not depend on.
    #
    # Servicing done AFTER registration is recorded as new service records, which
    # is how the numbers stay current without this value moving.
    if baseline is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "This vehicle already has a registration baseline and it cannot be "
                "changed. Log a service record instead to update a component."
            ),
        )

    trip_km = trip_distance_sum(db, vehicle_id)
    now = _now()

    baseline = VehicleBaseline(
        vehicle_id=vehicle_id,
        owner_id=user_id,
        condition=body.condition,
        baseline_odometer_km=body.odometer_km,
        # Anchor to the trips already recorded, so the odometer from here on is a
        # pure offset: baseline + (all trips) - (trips at this moment).
        trip_km_at_baseline=trip_km,
        recorded_at=now,
        updated_at=now,
    )
    db.add(baseline)
    db.commit()
    db.refresh(baseline)
    print(
        f"[baseline] vehicle={vehicle_id} condition={baseline.condition} "
        f"odometer={baseline.baseline_odometer_km:.0f}km trips_at_anchor={trip_km:.1f}km"
    )
    return VehicleBaselineOut(
        vehicle_id=baseline.vehicle_id,
        condition=baseline.condition,
        baseline_odometer_km=baseline.baseline_odometer_km,
        odometer_km=baseline.baseline_odometer_km,
        recorded_trip_km=trip_km,
        recorded_at=baseline.recorded_at,
        updated_at=baseline.updated_at,
    )


@router.get("/components/lifespans")
def component_lifespans() -> Dict[str, object]:
    """Expected life per component, so the registration UI can preview an
    inferred baseline without reimplementing the rule in TypeScript."""
    return {
        "expected_life_km": COMPONENT_EXPECTED_LIFE_KM,
        "wear_components": list(WEAR_COMPONENTS),
        "engine_oil_interval_km": ENGINE_OIL_INTERVAL_KM,
    }


# ---------------------------------------------------------------------------
# Service records
# ---------------------------------------------------------------------------

@router.post("/vehicle/{vehicle_id}/service", response_model=ServiceRecordOut, status_code=201)
def log_service(
    vehicle_id: str,
    body: ServiceRecordCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_user),
) -> ServiceRecordOut:
    if body.component not in VALID_COMPONENTS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown component '{body.component}'. Valid: {sorted(VALID_COMPONENTS)}",
        )
    if body.service_type not in SERVICE_TYPE_RESETS_WINDOW:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown service_type '{body.service_type}'. "
                   f"Valid: {sorted(SERVICE_TYPE_RESETS_WINDOW)}",
        )

    _assert_owner(db, vehicle_id, user_id)

    # An initial_reading describes the state of a component AT REGISTRATION, so
    # there can only ever be one per component. A later replacement is logged as
    # a `replacement`, which correctly resets the wear window from that point.
    if body.service_type == "initial_reading":
        existing = (
            db.query(ServiceRecord)
            .filter(
                ServiceRecord.vehicle_id == vehicle_id,
                ServiceRecord.component == body.component,
                ServiceRecord.service_type == "initial_reading",
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"The registration baseline for '{body.component}' is already set "
                    f"and cannot be changed. Log a replacement instead."
                ),
            )

    odometer_km, _, _ = current_odometer_km(db, vehicle_id)

    expected_life: Optional[float] = None
    notes = body.notes

    if body.basis == "unknown" and body.component in COMPONENT_EXPECTED_LIFE_KM:
        # The driver said "not sure". Infer rather than storing a zero that
        # would read as "this part is brand new".
        expected_life = float(COMPONENT_EXPECTED_LIFE_KM[body.component])
        install_km, km_on, basis = infer_install_km(odometer_km, expected_life)
        if not notes:
            # service-records.tsx already renders `notes`, so the estimate
            # explains itself in the history list with no UI work.
            notes = (
                f"Estimated at registration - assumed serviced on schedule every "
                f"{expected_life:,.0f} km. Tap to correct."
            )
    else:
        install_km = odometer_km - body.km_on_component
        km_on = body.km_on_component
        basis = "user"

    record = ServiceRecord(
        id=str(uuid.uuid4()),
        vehicle_id=vehicle_id,
        logged_by=user_id,
        component=body.component,
        service_type=body.service_type,
        service_date=body.service_date,
        created_at=_now(),
        km_on_component=km_on,
        odometer_km_at_service=odometer_km,
        install_km=install_km,
        basis=basis,
        expected_life_km_at_estimate=expected_life,
        item_name=body.item_name,
        is_original=body.is_original,
        garage_name=body.garage_name,
        cost_lkr=body.cost_lkr,
        notes=notes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # A replacement genuinely resets wear, so the "worst ever seen" clamp has to
    # go with it - otherwise brand-new brake pads would still report the old
    # worn-out figure forever.
    if SERVICE_TYPE_RESETS_WINDOW.get(body.service_type, False):
        clear_health_floor(db, vehicle_id, body.component)

    print(
        f"[service] vehicle={vehicle_id} component={body.component} type={body.service_type} "
        f"odometer={odometer_km:.0f}km install_km={install_km:.0f} km_on={km_on:.0f} basis={basis}"
    )
    return _to_out(record)


@router.get("/vehicle/{vehicle_id}/services", response_model=List[ServiceRecordOut])
def service_history(vehicle_id: str, db: Session = Depends(get_db)) -> List[ServiceRecordOut]:
    records = (
        db.query(ServiceRecord)
        .filter(ServiceRecord.vehicle_id == vehicle_id)
        .order_by(
            ServiceRecord.odometer_km_at_service.desc(),
            ServiceRecord.created_at.desc(),
        )
        .all()
    )
    return [_to_out(r) for r in records]


@router.get("/vehicle/{vehicle_id}/services/latest")
def latest_services(vehicle_id: str, db: Session = Depends(get_db)) -> Dict[str, LatestServiceEntry]:
    """Latest record of ANY type per component.

    Deliberately different from what health uses (latest record whose type
    RESETS the wear window): this answers "when was this last touched", which is
    what a service list wants, while wear only restarts on a replacement. Do not
    collapse the two.
    """
    odometer_km, _, _ = current_odometer_km(db, vehicle_id)
    out: Dict[str, LatestServiceEntry] = {}

    for component in COMPONENT_EXPECTED_LIFE_KM:
        record = (
            db.query(ServiceRecord)
            .filter(
                ServiceRecord.vehicle_id == vehicle_id,
                ServiceRecord.component == component,
            )
            .order_by(
                ServiceRecord.odometer_km_at_service.desc(),
                ServiceRecord.service_date.desc(),
                ServiceRecord.created_at.desc(),
            )
            .first()
        )
        if record is None:
            continue
        out[component] = LatestServiceEntry(
            service_type=record.service_type,
            service_date=record.service_date,
            km_on_component=record.km_on_component,
            resets_window=SERVICE_TYPE_RESETS_WINDOW.get(record.service_type, False),
            install_km=record.install_km,
            km_on_component_now=max(odometer_km - record.install_km, 0.0),
            basis=record.basis,
            is_estimated=record.basis != "user",
        )
    return out
