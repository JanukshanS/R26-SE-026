"""Used-vehicle baseline, end to end through the real API.

The stub model registry always answers "plenty of life left", so anything that
comes back Critical proves the WEAR term won - which is the whole point of the
feature. Without the stub these assertions would silently depend on whatever the
.joblib files happen to predict.
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
from app.database import Base, get_db
from app.main import app
from app.routers.predict import COMPONENT_FEATURE_MAP


class _StubModel:
    def __init__(self, rul_km):
        self._rul = rul_km

    def predict(self, X):
        return [self._rul]


class _StubRegistry:
    """Every model says a near-infinite RUL.

    Large enough that health_pct clamps to 100 for EVERY component -
    99,999 km would only be 66.7% of the engine's 150,000 km denominator
    and the test would be measuring the stub, not the code.
    """

    def __init__(self, rul_km=999_999.0):
        self._m = _StubModel(rul_km)

    def get(self, key):
        return self._m

    def __len__(self):
        return 8

    def available(self):
        return []


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "t.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    def _get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[require_user] = lambda: "test-user"

    with TestClient(app) as c:
        # AFTER the context is entered: TestClient runs the app's lifespan,
        # which loads the real .joblib models into app.state and would
        # otherwise clobber these stubs.
        app.state.models = _StubRegistry()
        app.state.best_models = {k: {"algorithm": "rf", "r2": 0.99} for k in COMPONENT_FEATURE_MAP}
        app.state.metrics = {}
        yield c

    app.dependency_overrides.clear()
    engine.dispose()


def _obd(offset, speed=60.0):
    return dict(timestamp_offset_sec=offset, rpm=1500, speed_kmh=speed, coolant_temp_c=90,
                battery_voltage_v=13.3, ltft_percent=0.0, throttle_percent=20,
                engine_load_percent=40, intake_air_temp_c=35)


def _imu(offset):
    return dict(timestamp_offset_sec=offset, accel_x=0.2, accel_y=0, accel_z=-1.0,
                gyro_x=0, gyro_y=0, gyro_z=0.1)


def _post_trip(client, vehicle_id="CBD-USED"):
    body = dict(trip_id=str(uuid.uuid4()), vehicle_id=vehicle_id, driver_id="d1",
                start_timestamp="2026-08-16T10:00:00Z",
                obd_readings=[_obd(i * 300) for i in range(5)],
                imu_readings=[_imu(i * 120) for i in range(10)])
    r = client.post("/process-trip", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_used_car_baseline_end_to_end(client):
    V = "CBD-USED"

    r = client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 141000, "condition": "used"})
    assert r.status_code == 201, r.text
    assert r.json()["baseline_odometer_km"] == 141000

    # "Not sure" about the tyres -> the server infers, ignoring km_on_component.
    r = client.post(f"/vehicle/{V}/service", json={
        "component": "tire", "service_type": "initial_reading",
        "service_date": "2026-08-16", "km_on_component": 0, "basis": "unknown",
    })
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["install_km"] == 100_000
    assert rec["km_on_component"] == 41_000
    assert rec["basis"] == "inferred_schedule"
    assert rec["is_estimated"] is True
    assert rec["resets_window"] is True
    assert "Estimated" in (rec["notes"] or "")

    latest = client.get(f"/vehicle/{V}/services/latest").json()
    assert latest["tire"]["install_km"] == 100_000
    assert latest["tire"]["is_estimated"] is True

    trip = _post_trip(client)
    health = client.get(f"/vehicle/{V}/health").json()

    # The odometer is the real one, not the sum of recorded trips.
    assert health["odometer_km"] == pytest.approx(141_000 + trip["distance_km"], abs=0.5)
    assert health["total_mileage_km"] == pytest.approx(health["odometer_km"], abs=0.5)
    assert health["vehicle_condition"] == "used"

    by_name = {c["component"]: c for c in health["components"]}

    tyres = by_name["Tires"]
    assert tyres["rul_source"] == "wear", "stub model says ~1M km; wear must win"
    assert tyres["is_estimated"] is True
    assert tyres["predicted_rul_km"] < 9_100
    assert tyres["status"] in ("Critical", "Poor")

    # Brakes and battery are inferred at REQUEST time even though no service
    # record was ever written for them - the stored rows are an audit trail,
    # not a correctness requirement.
    assert by_name["Brake Pads"]["rul_source"] == "wear"
    assert by_name["Battery"]["rul_source"] == "wear"

    # Engine is deliberately sensor-only: no wear term, no install km.
    engine = by_name["Engine"]
    assert engine.get("rul_source") is None
    assert engine.get("km_on_component") is None
    assert engine["health_pct"] == 100.0


def test_user_stated_replacement_beats_inference(client):
    V = "CBD-KNOWN"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 141000, "condition": "used"})
    # Driver knows: fitted 21,000 km ago (i.e. at 120,000).
    r = client.post(f"/vehicle/{V}/service", json={
        "component": "tire", "service_type": "replacement",
        "service_date": "2026-08-16", "km_on_component": 21000, "basis": "user",
    })
    assert r.json()["install_km"] == 120_000
    assert r.json()["is_estimated"] is False

    _post_trip(client, V)
    health = client.get(f"/vehicle/{V}/health").json()
    tyres = {c["component"]: c for c in health["components"]}["Tires"]
    assert tyres["is_estimated"] is False
    assert tyres["km_on_component"] > 21_000     # plus the trip just recorded
    assert tyres["predicted_rul_km"] < 29_000


def test_brand_new_vehicle_has_no_wear_penalty(client):
    V = "CBD-NEW"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 0, "condition": "new"})
    _post_trip(client, V)
    health = client.get(f"/vehicle/{V}/health").json()
    for c in health["components"]:
        assert c["health_pct"] >= 99.0, c["component"] + " penalised on a new car"


def test_no_baseline_is_unchanged_behaviour(client):
    """The migration story: every already-registered vehicle behaves as before."""
    V = "CBD-LEGACY"
    trip = _post_trip(client, V)
    health = client.get(f"/vehicle/{V}/health").json()

    assert health["vehicle_condition"] is None
    assert health["baseline_odometer_km"] is None
    # Odometer falls back to the trip sum, exactly as it always did.
    assert health["total_mileage_km"] == pytest.approx(trip["distance_km"], abs=0.5)
    for c in health["components"]:
        assert c.get("rul_source") is None
        assert c.get("km_on_component") is None
        assert c["health_pct"] == 100.0     # stub model, no wear term


def test_engine_oil_is_its_own_interval(client):
    V = "CBD-OIL"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 100000, "condition": "used"})
    _post_trip(client, V)

    health = client.get(f"/vehicle/{V}/health").json()
    assert health["engine_oil"]["interval_km"] == 5000
    assert health["engine_oil"]["km_since_change"] is None, "never logged -> not recorded"
    assert health["engine_oil"]["is_overdue"] is False

    client.post(f"/vehicle/{V}/service", json={
        "component": "engine", "service_type": "oil_change",
        "service_date": "2026-08-16", "km_on_component": 0,
    })
    health = client.get(f"/vehicle/{V}/health").json()
    oil = health["engine_oil"]
    assert oil["km_since_change"] == pytest.approx(0.0, abs=1.0)
    assert oil["km_remaining"] == pytest.approx(5000.0, abs=1.0)
    assert oil["is_overdue"] is False


def test_another_account_cannot_rewrite_history(client):
    V = "CBD-OWNED"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 50000, "condition": "used"})
    app.dependency_overrides[require_user] = lambda: "someone-else"
    r = client.post(f"/vehicle/{V}/service", json={
        "component": "tire", "service_type": "replacement",
        "service_date": "2026-08-16", "km_on_component": 0,
    })
    assert r.status_code == 403
    app.dependency_overrides[require_user] = lambda: "test-user"


def test_unknown_component_and_service_type_are_rejected(client):
    V = "CBD-VALID"
    base = {"service_date": "2026-08-16", "km_on_component": 0}
    r = client.post(f"/vehicle/{V}/service",
                    json={**base, "component": "gearbox", "service_type": "replacement"})
    assert r.status_code == 422 and "gearbox" in r.text
    r = client.post(f"/vehicle/{V}/service",
                    json={**base, "component": "tire", "service_type": "teleport"})
    assert r.status_code == 422 and "teleport" in r.text


def test_registration_baseline_cannot_be_changed(client):
    """Set once at registration and never again - it is a statement about the
    vehicle's history, and letting it move would let a driver quietly rewrite
    their maintenance position after the fact."""
    V = "CBD-LOCKED"
    assert client.put(f"/vehicle/{V}/baseline",
                      json={"odometer_km": 141000, "condition": "used"}).status_code == 201

    r = client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 10, "condition": "new"})
    assert r.status_code == 409
    assert "cannot be changed" in r.text

    health = client.get(f"/vehicle/{V}/health").json()
    assert health["baseline_odometer_km"] == 141000


def test_component_baseline_cannot_be_set_twice(client):
    V = "CBD-ONCE"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 141000, "condition": "used"})
    body = {"component": "tire", "service_type": "initial_reading",
            "service_date": "2026-08-16", "km_on_component": 0, "basis": "unknown"}
    assert client.post(f"/vehicle/{V}/service", json=body).status_code == 201
    r = client.post(f"/vehicle/{V}/service", json=body)
    assert r.status_code == 409
    assert "already set" in r.text


def test_a_later_replacement_is_still_allowed(client):
    """Locking the registration baseline must not stop the app doing its job:
    servicing done AFTER registration is exactly how the numbers stay current."""
    V = "CBD-SERVICEABLE"
    client.put(f"/vehicle/{V}/baseline", json={"odometer_km": 141000, "condition": "used"})
    client.post(f"/vehicle/{V}/service", json={
        "component": "tire", "service_type": "initial_reading",
        "service_date": "2026-08-16", "km_on_component": 0, "basis": "unknown"})

    r = client.post(f"/vehicle/{V}/service", json={
        "component": "tire", "service_type": "replacement",
        "service_date": "2026-08-16", "km_on_component": 0, "basis": "user"})
    assert r.status_code == 201
    assert r.json()["install_km"] == pytest.approx(141_000, abs=1)

    _post_trip(client, V)
    tyres = {c["component"]: c
             for c in client.get(f"/vehicle/{V}/health").json()["components"]}["Tires"]
    assert tyres["is_estimated"] is False, "a real replacement supersedes the estimate"
    assert tyres["health_pct"] > 90, "brand new tyres"
