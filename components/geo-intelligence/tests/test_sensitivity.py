"""Sensitivity overlay tests — POI proximity boosts, time gates, calendar, API."""
from __future__ import annotations

import json
import math
from datetime import date

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.auth import require_user
from src.sensitivity import (
    BRIDGE_BOOST,
    HOSPITAL_DECAY_M,
    HOSPITAL_MAX_BOOST,
    MARKET_BOOST,
    SCHOOL_BOOST,
    TOTAL_BOOST_CAP,
    SensitivityOverlay,
)

app.dependency_overrides[require_user] = lambda: "test-user"
client = TestClient(app)

# Synthetic POI cluster far from real Colombo data so distances are exact.
BASE_LAT, BASE_LNG = 5.0, 80.0
METERS_PER_DEG_LAT = 111_195.0


def _offset_lat(meters: float) -> float:
    return BASE_LAT + meters / METERS_PER_DEG_LAT


@pytest.fixture()
def overlay(tmp_path):
    poi = {
        "hospitals": [{"name": "Test Hospital", "lat": BASE_LAT, "lng": BASE_LNG}],
        "schools": [{"name": "Test School", "lat": _offset_lat(5000), "lng": BASE_LNG}],
        "markets": [{"name": "Test Market", "lat": _offset_lat(10000), "lng": BASE_LNG}],
        "bridges": [{
            "name": "Test Bridge",
            "road_type": "primary",
            "points": [[_offset_lat(15000), BASE_LNG], [_offset_lat(15050), BASE_LNG]],
        }],
    }
    holidays = {"holidays": [
        {"date": "2026-10-19", "name": "Test Monday Holiday", "verified": True},
        {"date": "2026-11-05", "name": "Test Thursday Holiday", "verified": True},
    ]}
    poi_path = tmp_path / "poi.json"
    holidays_path = tmp_path / "holidays.json"
    poi_path.write_text(json.dumps(poi))
    holidays_path.write_text(json.dumps(holidays))
    return SensitivityOverlay(poi_path=poi_path, holidays_path=holidays_path)


def test_hospital_boost_is_max_at_zero_distance(overlay):
    result = overlay.evaluate(BASE_LAT, BASE_LNG, hour=10, day_of_week=0)
    hospital = next(n for n in result["nearby"] if n["type"] == "hospital")
    assert hospital["boost"] == pytest.approx(HOSPITAL_MAX_BOOST, abs=1e-3)
    assert result["factor"] == pytest.approx(1.0 + HOSPITAL_MAX_BOOST, abs=1e-3)


def test_hospital_boost_decays_exponentially(overlay):
    result = overlay.evaluate(_offset_lat(HOSPITAL_DECAY_M), BASE_LNG, hour=10, day_of_week=0)
    hospital = next(n for n in result["nearby"] if n["type"] == "hospital")
    assert hospital["boost"] == pytest.approx(HOSPITAL_MAX_BOOST * math.exp(-1), abs=5e-3)


def test_school_boost_active_in_morning_window_on_weekday(overlay):
    result = overlay.evaluate(_offset_lat(5000), BASE_LNG, hour=7, day_of_week=1)
    school = next(n for n in result["nearby"] if n["type"] == "school")
    assert school["active"] is True
    assert school["boost"] == SCHOOL_BOOST


def test_school_boost_inactive_outside_window(overlay):
    result = overlay.evaluate(_offset_lat(5000), BASE_LNG, hour=10, day_of_week=1)
    school = next(n for n in result["nearby"] if n["type"] == "school")
    assert school["active"] is False
    assert school["boost"] == 0.0


def test_school_boost_inactive_on_weekend(overlay):
    result = overlay.evaluate(_offset_lat(5000), BASE_LNG, hour=7, day_of_week=6)
    school = next(n for n in result["nearby"] if n["type"] == "school")
    assert school["active"] is False


def test_bridge_boost_within_radius(overlay):
    result = overlay.evaluate(_offset_lat(15000), BASE_LNG, hour=10, day_of_week=0)
    bridge = next(n for n in result["nearby"] if n["type"] == "bridge")
    assert bridge["boost"] == BRIDGE_BOOST


def test_market_active_on_weekend_and_weekday_dawn(overlay):
    weekend = overlay.evaluate(_offset_lat(10000), BASE_LNG, hour=12, day_of_week=5)
    assert next(n for n in weekend["nearby"] if n["type"] == "market")["active"] is True
    dawn = overlay.evaluate(_offset_lat(10000), BASE_LNG, hour=5, day_of_week=2)
    assert next(n for n in dawn["nearby"] if n["type"] == "market")["active"] is True
    weekday_noon = overlay.evaluate(_offset_lat(10000), BASE_LNG, hour=12, day_of_week=2)
    assert next(n for n in weekday_noon["nearby"] if n["type"] == "market")["boost"] == 0.0
    assert next(n for n in weekday_noon["nearby"] if n["type"] == "market")["active"] is False


def test_getaway_eve_before_monday_holiday(overlay):
    assert overlay.is_getaway_eve(date(2026, 10, 16)) is True


def test_ordinary_friday_is_not_getaway_eve(overlay):
    assert overlay.is_getaway_eve(date(2026, 10, 9)) is False


def test_holiday_itself_is_not_getaway_eve(overlay):
    assert overlay.is_holiday(date(2026, 10, 19)) is True
    assert overlay.is_getaway_eve(date(2026, 10, 19)) is False


def test_getaway_eve_adds_boost_through_evaluate(overlay):
    result = overlay.evaluate(BASE_LAT + 2.0, BASE_LNG + 2.0, hour=17, day_of_week=4,
                              incident_date=date(2026, 10, 16))
    assert result["is_getaway_eve"] is True
    assert result["factor"] == pytest.approx(1.10, abs=1e-3)


def test_total_boost_is_capped(tmp_path):
    poi = {
        "hospitals": [{"name": "H", "lat": BASE_LAT, "lng": BASE_LNG}],
        "schools": [{"name": "S", "lat": BASE_LAT, "lng": BASE_LNG}],
        "markets": [{"name": "M", "lat": BASE_LAT, "lng": BASE_LNG}],
        "bridges": [{"name": "B", "road_type": "primary",
                     "points": [[BASE_LAT, BASE_LNG]]}],
    }
    holidays = {"holidays": [{"date": "2026-10-19", "name": "T", "verified": True}]}
    (tmp_path / "poi.json").write_text(json.dumps(poi))
    (tmp_path / "holidays.json").write_text(json.dumps(holidays))
    stacked = SensitivityOverlay(poi_path=tmp_path / "poi.json",
                                 holidays_path=tmp_path / "holidays.json")
    result = stacked.evaluate(BASE_LAT, BASE_LNG, hour=7, day_of_week=4,
                              incident_date=date(2026, 10, 16))
    assert result["factor"] == pytest.approx(1.0 + TOTAL_BOOST_CAP, abs=1e-3)


def test_missing_data_degrades_to_neutral(tmp_path):
    empty = SensitivityOverlay(poi_path=tmp_path / "nope.json",
                               holidays_path=tmp_path / "nada.json")
    result = empty.evaluate(BASE_LAT, BASE_LNG, hour=8, day_of_week=0)
    assert result["factor"] == 1.0
    assert result["nearby"] == []
    assert result["data_available"] is False


# ── API surface ──────────────────────────────────────────────────────────────

SCORE_BODY = {
    "latitude": 6.9271,
    "longitude": 79.8612,
    "road_type": "primary",
    "total_lanes": 2,
    "lanes_blocked": 1,
    "incident_type": "accident_major",
    "hour": 8,
    "day_of_week": 0,
}


def test_score_response_includes_sensitivity_block():
    body = client.post("/v1/score", json=SCORE_BODY).json()
    sens = body["sensitivity"]
    assert {"factor", "adjusted_score", "nearby", "is_holiday",
            "is_getaway_eve", "data_available"} <= set(sens)
    assert 1.0 <= sens["factor"] <= 1.0 + TOTAL_BOOST_CAP
    assert sens["adjusted_score"] >= body["score"] or sens["adjusted_score"] == 10.0
    assert sens["adjusted_score"] <= 10.0


def test_score_base_score_unchanged_by_overlay():
    without_date = client.post("/v1/score", json=SCORE_BODY).json()
    with_date = client.post(
        "/v1/score", json={**SCORE_BODY, "date": "2026-04-10"}
    ).json()
    assert without_date["score"] == with_date["score"]


def test_score_flags_getaway_eve_before_new_year_long_weekend():
    body = client.post(
        "/v1/score", json={**SCORE_BODY, "date": "2026-04-10", "hour": 17, "day_of_week": 4}
    ).json()
    assert body["sensitivity"]["is_getaway_eve"] is True
    assert body["sensitivity"]["factor"] > 1.0


def test_score_flags_holiday_on_new_year_day():
    body = client.post(
        "/v1/score", json={**SCORE_BODY, "date": "2026-04-13", "day_of_week": 0}
    ).json()
    assert body["sensitivity"]["is_holiday"] is True


def test_score_422_on_malformed_date():
    res = client.post("/v1/score", json={**SCORE_BODY, "date": "not-a-date"})
    assert res.status_code == 422
