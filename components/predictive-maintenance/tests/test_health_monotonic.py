"""Health must never climb on its own.

Reproduces what was observed in real testing: health read 56%, then 64%, then
67%, then fell back to 52% - because it was computed from a rolling average of
driving BEHAVIOUR, so a few gentle trips made worn parts look recovered.
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import require_user
from app.baseline import MIN_DISTANCE_FOR_CONFIDENCE_KM
from app.database import Base, get_db
from app.main import app
from app.routers.predict import COMPONENT_FEATURE_MAP


class _Swinging:
    """Stands in for the ML models, answering differently each time it is asked.

    Lets the test drive health up and down on demand, which is the behaviour
    being guarded against - no dependence on what the real .joblib files think.
    """

    def __init__(self):
        self.rul = 20_000.0

    def predict(self, X):
        return [self.rul]


class _Registry:
    def __init__(self, model):
        self._m = model

    def get(self, key):
        return self._m

    def __len__(self):
        return 8

    def available(self):
        return []


@pytest.fixture
def ctx(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path/'m.db'}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=eng)
    Base.metadata.create_all(eng)

    def _get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[require_user] = lambda: "u1"
    model = _Swinging()
    with TestClient(app) as c:
        app.state.models = _Registry(model)
        app.state.best_models = {k: {"algorithm": "rf", "r2": 0.9} for k in COMPONENT_FEATURE_MAP}
        app.state.metrics = {}
        yield c, model
    app.dependency_overrides.clear()
    eng.dispose()


def _trip(client, vid, km_per_reading=60.0):
    body = dict(trip_id=str(uuid.uuid4()), vehicle_id=vid, driver_id="d",
                start_timestamp="2026-08-16T10:00:00Z",
                obd_readings=[dict(timestamp_offset_sec=i*300, rpm=1500, speed_kmh=km_per_reading,
                                   coolant_temp_c=90, battery_voltage_v=13.3, ltft_percent=0.0,
                                   throttle_percent=20, engine_load_percent=40,
                                   intake_air_temp_c=35) for i in range(5)],
                imu_readings=[dict(timestamp_offset_sec=i*120, accel_x=0.2, accel_y=0,
                                   accel_z=-1.0, gyro_x=0, gyro_y=0, gyro_z=0.1)
                              for i in range(10)])
    r = client.post("/process-trip", json=body)
    assert r.status_code == 201, r.text


def _brake_health(client, vid):
    h = client.get(f"/vehicle/{vid}/health").json()
    return {c["component"]: c for c in h["components"]}["Brake Pads"]["health_pct"]


def test_health_never_climbs_after_gentle_driving(ctx):
    client, model = ctx
    V = "SWING"

    _trip(client, V)
    model.rul = 20_000.0
    first = _brake_health(client, V)

    # The driver has a gentle week; the model now says the parts will last far
    # longer. Health must NOT go up - brake pads do not grow back.
    model.rul = 39_000.0
    _trip(client, V)
    second = _brake_health(client, V)
    assert second <= first, f"health climbed {first} -> {second}"

    # Harsh driving may still push it down.
    model.rul = 8_000.0
    _trip(client, V)
    third = _brake_health(client, V)
    assert third < second

    # And it stays down afterwards, even if driving improves again.
    model.rul = 39_000.0
    _trip(client, V)
    assert _brake_health(client, V) <= third


def test_replacing_a_part_does_reset_it(ctx):
    """The clamp must not trap a car forever: fitting a new part is the one
    thing that legitimately restores health."""
    client, model = ctx
    V = "RESET"
    model.rul = 5_000.0
    _trip(client, V)
    worn = _brake_health(client, V)
    assert worn < 30

    client.post(f"/vehicle/{V}/service", json={
        "component": "brake", "service_type": "replacement",
        "service_date": "2026-08-16", "km_on_component": 0})

    model.rul = 39_000.0
    _trip(client, V)
    assert _brake_health(client, V) > worn, "a new part must be able to raise health"


def test_early_readings_are_flagged_provisional(ctx):
    client, model = ctx
    V = "EARLY"
    _trip(client, V, km_per_reading=6.0)     # ~2 km, well under the 50 km mark
    h = client.get(f"/vehicle/{V}/health").json()
    assert h["is_provisional"] is True
    assert h["min_distance_for_confidence_km"] == MIN_DISTANCE_FOR_CONFIDENCE_KM
    assert "provisional" in h["components"][0]["confidence_note"]


def test_health_does_not_regress_into_a_query_per_component(ctx, tmp_path):
    """A real health check was traced to 17 sequential database round trips -
    three near-identical per-component service lookups, four separate
    health-floor reads, four separate commits, and the trip table queried
    twice. None of that changed what a driver saw, so it was pure overhead,
    and on a real device it was the difference between a fast screen and a
    5-10 second wait.

    This does not assert the exact number 17 became some other exact number -
    that would break on the next unrelated schema change. It asserts a
    generous ceiling, so if the batching in app/baseline.py and
    _attach_faults ever regresses back toward one-query-per-component, this
    fails LOUD instead of silently costing another 5 seconds on a real
    device with nothing in a code review to catch it.
    """
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    client, model = ctx
    V = "QCOUNT"

    # A vehicle with real baseline + service history, not the no-baseline
    # shortcut every other test in this file takes - that shortcut skips
    # resolve_component_states and latest_resetting_records entirely, so it
    # would not exercise the thing being guarded here at all.
    client.put(f"/vehicle/{V}/baseline", json={"condition": "used", "odometer_km": 40_000})
    _trip(client, V)
    client.post(f"/vehicle/{V}/service", json={
        "component": "brake", "service_type": "replacement",
        "service_date": "2026-01-01", "km_on_component": 0})

    # One call to warm the ComponentHealthFloor rows - the interesting case is
    # steady state, where those rows already exist and are being read and
    # possibly updated, not the one-time "no floor row yet" insert path.
    client.get(f"/vehicle/{V}/health")

    # A second, separate engine+session pair pointed at the SAME database
    # file, so the counting connection is not the one the app's own
    # dependency-injected session uses - counting on a shared connection would
    # also pick up whatever SQLAlchemy does internally to manage that session.
    db_path = None
    for existing in tmp_path.glob("*.db"):
        db_path = existing
    assert db_path is not None, "expected the ctx fixture's sqlite file to exist by now"

    counting_engine = create_engine(f"sqlite:///{db_path}")
    statements: list[str] = []

    def _count(conn, cursor, statement, *_args):
        statements.append(statement)

    event.listen(counting_engine, "before_cursor_execute", _count)
    # The app's own session is a different connection to the same file, so
    # this cannot observe it directly - instead, temporarily point the app at
    # THIS engine for the one request being measured.
    from app.database import get_db as real_get_db

    def _instrumented_get_db():
        session = sessionmaker(bind=counting_engine)()
        try:
            yield session
        finally:
            session.close()

    from app.main import app as fastapi_app
    original_override = fastapi_app.dependency_overrides[real_get_db]
    fastapi_app.dependency_overrides[real_get_db] = _instrumented_get_db
    try:
        r = client.get(f"/vehicle/{V}/health")
        assert r.status_code == 200, r.text
    finally:
        # Restore the fixture's own session, not just any session - the ctx
        # fixture's own teardown still needs to run against ITS engine.
        fastapi_app.dependency_overrides[real_get_db] = original_override
        event.remove(counting_engine, "before_cursor_execute", _count)
        counting_engine.dispose()

    # Measured at exactly 7 with every batching fix in place: trips, baseline,
    # resetting-records (one query for all wear components, not three), engine
    # oil, health floors (one query for all four components, not four), one
    # commit for all of them (not four), and one fault-history query. Ceiling
    # set to 10 rather than asserting 7 exactly, so an unrelated schema change
    # does not break this - but the regression this guards against adds AT
    # LEAST one query per component (4 more), which 10 still catches outright.
    print(f"[query-count] {len(statements)} statements for one /health call")
    assert len(statements) <= 10, (
        f"{len(statements)} statements for one health check - expected 7. "
        f"Statements:\n" + "\n".join(statements)
    )


def test_short_trips_are_never_discarded(ctx):
    """Someone driving 800 m twice a day still accumulates real wear, and
    short-hop driving is harder on an engine than long runs. Their data must
    count."""
    client, model = ctx
    V = "SHORTHOP"
    for _ in range(6):
        _trip(client, V, km_per_reading=4.0)   # ~1.3 km per trip
    h = client.get(f"/vehicle/{V}/health").json()
    assert h["trip_count"] == 6
    assert h["total_mileage_km"] > 0
