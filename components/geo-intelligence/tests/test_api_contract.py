"""API contract tests — OpenAPI alignment, aliases, errors, enriched hotspots."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api import DATA_DIR, app

client = TestClient(app)

MALABE_SCORE_BODY = {
    "latitude": 6.9271,
    "longitude": 79.8612,
    "road_type": "primary",
    "total_lanes": 2,
    "lanes_blocked": 1,
    "incident_type": "accident_major",
    "hour": 8,
    "day_of_week": 0,
}

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "golden_scores.json"


def test_health_returns_200():
    assert client.get("/v1/health").status_code == 200


def test_health_payload_shape():
    data = client.get("/v1/health").json()
    assert data["status"] == "ok"
    assert data["service"] == "geo-intelligence"
    assert "version" in data


def test_health_weights_match_original_contract():
    weights = client.get("/v1/health").json()["weights"]
    assert set(weights) == {
        "capacity_loss",
        "traffic_volume",
        "temporal",
        "location",
        "incident_severity",
    }
    assert abs(sum(weights.values()) - 1.0) < 1e-9
    assert weights["capacity_loss"] == 0.25


def test_score_returns_200_with_valid_body():
    res = client.post("/v1/score", json=MALABE_SCORE_BODY)
    assert res.status_code == 200
    body = res.json()
    assert 1.0 <= body["score"] <= 10.0
    assert body["priority"] in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}


def test_score_response_includes_factors_and_prediction():
    body = client.post("/v1/score", json=MALABE_SCORE_BODY).json()
    assert set(body["factors"]) == {
        "capacity_loss",
        "traffic_volume",
        "temporal",
        "location",
        "incident_severity",
    }
    assert {"queue_km", "vehicle_hours_lost", "recovery_min"} <= set(body["prediction"])


def test_score_400_when_lanes_blocked_exceeds_total_lanes():
    bad = {**MALABE_SCORE_BODY, "lanes_blocked": 3, "total_lanes": 2}
    res = client.post("/v1/score", json=bad)
    assert res.status_code == 400
    assert "lanes_blocked" in res.json()["detail"]


def test_score_422_when_hour_out_of_range():
    bad = {**MALABE_SCORE_BODY, "hour": 25}
    assert client.post("/v1/score", json=bad).status_code == 422


def test_score_accepts_public_major_accident_alias():
    alias_body = {**MALABE_SCORE_BODY, "incident_type": "major_accident"}
    canonical_body = {**MALABE_SCORE_BODY, "incident_type": "accident_major"}
    alias_score = client.post("/v1/score", json=alias_body).json()["score"]
    canonical_score = client.post("/v1/score", json=canonical_body).json()["score"]
    assert alias_score == canonical_score


def test_score_accepts_overheating():
    body = {**MALABE_SCORE_BODY, "incident_type": "overheating"}
    res = client.post("/v1/score", json=body)
    assert res.status_code == 200
    assert 1.0 <= res.json()["score"] <= 10.0


def test_score_accepts_lockout():
    body = {**MALABE_SCORE_BODY, "incident_type": "lockout"}
    res = client.post("/v1/score", json=body)
    assert res.status_code == 200
    assert 1.0 <= res.json()["score"] <= 10.0


@pytest.mark.parametrize("case", json.loads(FIXTURES.read_text()))
def test_score_golden_fixture_within_epsilon(case):
    res = client.post("/v1/score", json=case["request"])
    assert res.status_code == 200
    score = res.json()["score"]
    assert abs(score - case["expected_score"]) <= case["epsilon"]


def test_score_more_blocked_lanes_not_lower_than_fewer():
    one = client.post("/v1/score", json={**MALABE_SCORE_BODY, "lanes_blocked": 1}).json()["score"]
    two = client.post("/v1/score", json={**MALABE_SCORE_BODY, "lanes_blocked": 2}).json()["score"]
    assert two >= one


def test_uncertainty_returns_200():
    res = client.post("/v1/score/uncertainty", json=MALABE_SCORE_BODY)
    assert res.status_code == 200
    body = res.json()
    assert {"score_mean", "score_p05", "score_p95", "score_std"} <= set(body)


def test_uncertainty_band_ordering():
    body = client.post("/v1/score/uncertainty", json=MALABE_SCORE_BODY).json()
    assert body["score_p05"] <= body["score_mean"] <= body["score_p95"]


def test_uncertainty_400_when_lanes_blocked_invalid():
    bad = {**MALABE_SCORE_BODY, "lanes_blocked": 5, "total_lanes": 2}
    assert client.post("/v1/score/uncertainty", json=bad).status_code == 400


def test_timeline_returns_200():
    res = client.post("/v1/score/timeline", json=MALABE_SCORE_BODY)
    assert res.status_code == 200
    body = res.json()
    assert len(body["minutes"]) == len(body["impact"])


def test_timeline_respects_horizon_and_step():
    body = client.post(
        "/v1/score/timeline",
        json={**MALABE_SCORE_BODY, "horizon_min": 30, "step_min": 10},
    ).json()
    assert body["minutes"] == [0, 10, 20, 30]


def test_timeline_400_when_lanes_blocked_invalid():
    bad = {**MALABE_SCORE_BODY, "lanes_blocked": 4, "total_lanes": 2}
    assert client.post("/v1/score/timeline", json=bad).status_code == 400


def test_hotspots_returns_200_when_data_present():
    res = client.get("/v1/hotspots")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_hotspots_count_is_25_after_r1_publish():
    rows = client.get("/v1/hotspots").json()
    assert len(rows) == 25


def test_hotspots_503_when_file_missing(monkeypatch, tmp_path):
    monkeypatch.setattr("src.api.DATA_DIR", tmp_path)
    res = client.get("/v1/hotspots")
    assert res.status_code == 503
    assert "hotspot" in res.json()["detail"].lower()


def test_hotspots_field_names_snake_case():
    rows = client.get("/v1/hotspots").json()
    if not rows:
        pytest.skip("no hotspot data")
    for key in rows[0]:
        assert key == key.lower()


def test_hotspots_enriched_fields_after_r3():
    rows = client.get("/v1/hotspots").json()
    assert rows
    first = rows[0]
    for field in ("road_type", "incident_type", "peak_hour", "radius_m"):
        assert field in first
        assert first[field] is not None


def test_stats_returns_200_when_data_present():
    res = client.get("/v1/stats")
    assert res.status_code == 200
    assert "totalIncidents" in res.json()


def test_stats_503_when_file_missing(monkeypatch, tmp_path):
    monkeypatch.setattr("src.api.DATA_DIR", tmp_path)
    res = client.get("/v1/stats")
    assert res.status_code == 503


def test_stats_priority_dist_shape():
    body = client.get("/v1/stats").json()
    dist = body.get("priorityDist", {})
    for level in ("HIGH", "MEDIUM", "CRITICAL", "LOW"):
        assert level in dist


def test_score_varies_by_road_type_motorway_vs_residential():
    motorway = client.post(
        "/v1/score",
        json={**MALABE_SCORE_BODY, "road_type": "motorway"},
    ).json()["score"]
    residential = client.post(
        "/v1/score",
        json={**MALABE_SCORE_BODY, "road_type": "residential"},
    ).json()["score"]
    assert motorway != residential


def test_score_varies_by_lanes_blocked():
    one = client.post("/v1/score", json={**MALABE_SCORE_BODY, "lanes_blocked": 1}).json()["score"]
    two = client.post("/v1/score", json={**MALABE_SCORE_BODY, "lanes_blocked": 2}).json()["score"]
    assert two >= one
