"""The batched replacements for baseline.py's per-component database calls.

A real health check was tracked down to 17 sequential round trips to
Postgres for a single request - three near-identical per-component service
lookups, four separate health-floor reads, four separate commits, and the
same trip table queried twice. None of that changed what a driver saw; it
only changed how many times the server asked the database the same kind of
question. These tests exist to prove the batched versions give the exact
same answers as the one-round-trip-per-component originals, since the
whole point of batching was to change nothing observable.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.baseline import (
    WEAR_COMPONENTS,
    apply_health_floor,
    current_odometer_km,
    latest_resetting_records,
    load_health_floors,
)
from app.database import Base
from app.models import ComponentHealthFloor, ServiceRecord, TripMetrics, VehicleBaseline


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _service_record(
    vehicle_id: str, component: str, *, odometer: float, install_km: float,
    service_type: str = "replacement", date: str = "2026-01-01", basis: str = "user",
) -> ServiceRecord:
    return ServiceRecord(
        id=str(uuid.uuid4()), vehicle_id=vehicle_id, component=component,
        service_type=service_type, service_date=date, created_at=_now(),
        km_on_component=max(odometer - install_km, 0.0),
        odometer_km_at_service=odometer, install_km=install_km, basis=basis,
    )


def _trip(vehicle_id: str, distance_km: float) -> TripMetrics:
    """The columns record_codes/health actually touch. Everything else the
    model has zero values, which is fine - these tests are about which rows
    get fetched, not about wear arithmetic."""
    return TripMetrics(
        trip_id=str(uuid.uuid4()), vehicle_id=vehicle_id, driver_id="d",
        start_timestamp="2026-01-01T00:00:00Z", stored_at="2026-01-01T00:01:00Z",
        duration_minutes=10.0, distance_km=distance_km,
        avg_rpm=1500.0, max_rpm=2000.0, avg_engine_load=30.0,
        max_coolant_temp_c=90.0, ltft_std=1.0,
        braking_events=1, braking_frequency=0.1, avg_deceleration_intensity=1.0,
        cornering_events=1, cornering_frequency=0.1, avg_speed_kmh=50.0,
        total_mileage_km=distance_km,
        avg_battery_voltage_v=14.0, min_battery_voltage_v=12.4,
        voltage_std=0.1, avg_iat_c=25.0,
    )


# ── latest_resetting_records: the 3-queries-into-1 merge ───────────────────

def test_finds_the_latest_record_for_every_component_in_one_query(db):
    db.add(_service_record("V1", "brake", odometer=10_000, install_km=10_000))
    db.add(_service_record("V1", "tire", odometer=20_000, install_km=15_000))
    db.add(_service_record("V1", "battery", odometer=30_000, install_km=0))
    db.commit()

    latest = latest_resetting_records(db, "V1")

    assert set(latest) == {"brake", "tire", "battery"}
    assert latest["brake"].install_km == 10_000
    assert latest["tire"].install_km == 15_000
    assert latest["battery"].install_km == 0


def test_picks_the_highest_odometer_row_per_component_not_the_last_inserted(db):
    """The merge relies on one global ORDER BY, then first-seen-per-component.
    Insertion order must not matter - only the ordering columns may."""
    db.add(_service_record("V1", "brake", odometer=5_000, install_km=5_000))
    db.add(_service_record("V1", "brake", odometer=45_000, install_km=45_000))  # inserted second, but the real latest
    db.add(_service_record("V1", "brake", odometer=25_000, install_km=25_000))
    db.commit()

    latest = latest_resetting_records(db, "V1")

    assert latest["brake"].install_km == 45_000


def test_component_with_no_resetting_record_is_absent_not_a_default(db):
    db.add(_service_record("V1", "brake", odometer=10_000, install_km=10_000))
    db.commit()

    latest = latest_resetting_records(db, "V1")

    assert "brake" in latest
    assert "tire" not in latest
    assert "battery" not in latest


def test_non_resetting_service_types_are_ignored(db):
    """An oil change or inspection does not put a new part in - it must never
    be mistaken for the row that resets the wear window."""
    db.add(_service_record("V1", "brake", odometer=10_000, install_km=10_000,
                            service_type="inspection"))
    db.commit()

    assert "brake" not in latest_resetting_records(db, "V1")


def test_a_different_vehicles_records_are_never_mixed_in(db):
    db.add(_service_record("V1", "brake", odometer=10_000, install_km=10_000))
    db.add(_service_record("V2", "brake", odometer=99_000, install_km=99_000))
    db.commit()

    latest = latest_resetting_records(db, "V1")

    assert latest["brake"].install_km == 10_000


def test_matches_calling_the_old_single_component_query_three_times(db):
    """The bulk version must be indistinguishable from three separate lookups
    - that equivalence is the entire justification for merging them."""
    from app.baseline import SERVICE_TYPE_RESETS_WINDOW

    db.add(_service_record("V1", "brake", odometer=8_000, install_km=8_000))
    db.add(_service_record("V1", "brake", odometer=30_000, install_km=30_000))
    db.add(_service_record("V1", "tire", odometer=12_000, install_km=12_000))
    db.commit()

    def old_way(component: str):
        resetting = [t for t, r in SERVICE_TYPE_RESETS_WINDOW.items() if r]
        return (
            db.query(ServiceRecord)
            .filter(
                ServiceRecord.vehicle_id == "V1",
                ServiceRecord.component == component,
                ServiceRecord.service_type.in_(resetting),
            )
            .order_by(
                ServiceRecord.odometer_km_at_service.desc(),
                ServiceRecord.service_date.desc(),
                ServiceRecord.created_at.desc(),
            )
            .first()
        )

    bulk = latest_resetting_records(db, "V1")
    for component in WEAR_COMPONENTS:
        expected = old_way(component)
        if expected is None:
            assert component not in bulk
        else:
            assert bulk[component].id == expected.id


# ── load_health_floors / apply_health_floor: the 4-selects-4-commits merge ─

def test_a_new_component_stages_an_insert_without_committing(db):
    floors = load_health_floors(db, "V1")
    assert floors == {}

    health_pct, rul_km, clamped = apply_health_floor(floors, db, "V1", "brake", 80.0, 32_000.0)

    assert (health_pct, rul_km, clamped) == (80.0, 32_000.0, False)
    # Staged via db.add(), not committed - proven by rollback discarding it.
    # A same-session query would show the row anyway (SQLAlchemy autoflushes
    # pending changes before it queries, which is not the same thing as durably
    # committed), so a plain count() here would pass whether or not this
    # function had committed internally. Rollback is the check that actually
    # distinguishes the two.
    db.rollback()
    assert db.query(ComponentHealthFloor).count() == 0

    floors = load_health_floors(db, "V1")
    apply_health_floor(floors, db, "V1", "brake", 80.0, 32_000.0)
    db.commit()
    assert db.query(ComponentHealthFloor).count() == 1


def test_a_worse_reading_updates_the_floor_in_place(db):
    db.add(ComponentHealthFloor(vehicle_id="V1", component="brake",
                                health_pct=80.0, rul_km=32_000.0, observed_at=_now()))
    db.commit()

    floors = load_health_floors(db, "V1")
    health_pct, rul_km, clamped = apply_health_floor(floors, db, "V1", "brake", 40.0, 16_000.0)

    assert (health_pct, rul_km, clamped) == (40.0, 16_000.0, False)


def test_a_better_reading_is_clamped_to_the_worst_ever_seen(db):
    db.add(ComponentHealthFloor(vehicle_id="V1", component="brake",
                                health_pct=40.0, rul_km=16_000.0, observed_at=_now()))
    db.commit()

    floors = load_health_floors(db, "V1")
    health_pct, rul_km, clamped = apply_health_floor(floors, db, "V1", "brake", 90.0, 36_000.0)

    assert (health_pct, rul_km, clamped) == (40.0, 16_000.0, True)


def test_four_components_in_one_loaded_dict_do_not_cross_contaminate(db):
    """The whole point of loading all four floors at once: one component's
    clamp must never read or write another's row."""
    db.add(ComponentHealthFloor(vehicle_id="V1", component="brake",
                                health_pct=40.0, rul_km=16_000.0, observed_at=_now()))
    db.add(ComponentHealthFloor(vehicle_id="V1", component="tire",
                                health_pct=70.0, rul_km=35_000.0, observed_at=_now()))
    db.commit()

    floors = load_health_floors(db, "V1")

    engine_result = apply_health_floor(floors, db, "V1", "engine", 95.0, 140_000.0)
    brake_result = apply_health_floor(floors, db, "V1", "brake", 90.0, 36_000.0)   # better -> clamped
    tire_result = apply_health_floor(floors, db, "V1", "tire", 20.0, 10_000.0)     # worse -> updates
    battery_result = apply_health_floor(floors, db, "V1", "battery", 100.0, 80_000.0)

    assert engine_result == (95.0, 140_000.0, False)          # new row, not clamped
    assert brake_result == (40.0, 16_000.0, True)              # untouched by tire/engine
    assert tire_result == (20.0, 10_000.0, False)              # its own row updated
    assert battery_result == (100.0, 80_000.0, False)          # new row, not clamped

    db.commit()
    rows = {r.component: r for r in db.query(ComponentHealthFloor).filter_by(vehicle_id="V1")}
    assert rows["brake"].health_pct == 40.0    # never touched
    assert rows["tire"].health_pct == 20.0     # the worse reading was recorded
    assert len(rows) == 4


def test_a_second_vehicles_floor_is_never_visible_to_the_first(db):
    db.add(ComponentHealthFloor(vehicle_id="V2", component="brake",
                                health_pct=5.0, rul_km=1_000.0, observed_at=_now()))
    db.commit()

    floors = load_health_floors(db, "V1")
    assert floors == {}


def test_committing_once_after_the_loop_persists_every_staged_change(db):
    """Simulates predict.py's actual usage: load once, apply four times in a
    loop, commit once at the end - not once per component."""
    floors = load_health_floors(db, "V1")
    for component, pct, rul in [
        ("engine", 90.0, 130_000.0), ("brake", 60.0, 24_000.0),
        ("tire", 70.0, 35_000.0), ("battery", 85.0, 68_000.0),
    ]:
        apply_health_floor(floors, db, "V1", component, pct, rul)

    # Nothing committed yet - proven the same way, by rolling back and
    # checking it is gone, since a same-session count() would autoflush and
    # see the rows regardless of whether they were ever committed.
    db.rollback()
    assert db.query(ComponentHealthFloor).count() == 0

    floors = load_health_floors(db, "V1")
    for component, pct, rul in [
        ("engine", 90.0, 130_000.0), ("brake", 60.0, 24_000.0),
        ("tire", 70.0, 35_000.0), ("battery", 85.0, 68_000.0),
    ]:
        apply_health_floor(floors, db, "V1", component, pct, rul)
    db.commit()
    assert db.query(ComponentHealthFloor).count() == 4


# ── current_odometer_km(trips=...): skip the duplicate SUM query ──────────

def test_passing_trips_matches_the_query_based_sum(db):
    for km in (100.0, 250.0, 75.0):
        db.add(_trip("V1", km))
    db.add(VehicleBaseline(vehicle_id="V1", condition="used",
                           baseline_odometer_km=50_000.0, trip_km_at_baseline=0.0,
                           recorded_at=_now(), updated_at=_now()))
    db.commit()

    trips = db.query(TripMetrics).filter(TripMetrics.vehicle_id == "V1").all()

    via_query = current_odometer_km(db, "V1")
    via_trips = current_odometer_km(db, "V1", trips=trips)

    assert via_trips == via_query


def test_passing_an_empty_trip_list_gives_zero_not_the_query_result(db):
    """An explicit empty list is a real answer (a vehicle with no trips), not
    a signal to fall back to the query - only None means "not supplied"."""
    db.add(VehicleBaseline(vehicle_id="V1", condition="new",
                           baseline_odometer_km=0.0, trip_km_at_baseline=0.0,
                           recorded_at=_now(), updated_at=_now()))
    db.commit()

    odometer, trip_km, _ = current_odometer_km(db, "V1", trips=[])

    assert trip_km == 0.0
    assert odometer == 0.0


def test_no_baseline_still_falls_back_correctly_with_trips_supplied(db):
    for km in (40.0, 60.0):
        db.add(_trip("V1", km))
    db.commit()
    trips = db.query(TripMetrics).filter(TripMetrics.vehicle_id == "V1").all()

    odometer, trip_km, baseline = current_odometer_km(db, "V1", trips=trips)

    assert baseline is None
    assert odometer == trip_km == 100.0
