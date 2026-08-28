"""Road resolution from GPS — the fix for the hardcoded `road_type: 'primary'`.

The guarantee these tests protect: resolving a road may only ever *improve* a
score. When resolution misses, the request must score exactly as it did when
dispatch hardcoded primary/2-lane, so no historical result silently shifts.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.auth import require_user
from src.roads import (
    CLASS_DEFAULT_LANES,
    FALLBACK_ROAD_TYPE,
    FALLBACK_TOTAL_LANES,
    MATCH_CUTOFF_M,
    RoadNetwork,
    _point_segment_distance_m,
    network,
)

app.dependency_overrides[require_user] = lambda: "test-user"
client = TestClient(app)

# A synthetic network far from real Colombo geometry so distances are exact.
BASE_LAT, BASE_LNG = 5.0, 80.0
M_PER_DEG_LAT = 110_540.0


def _lat_offset(meters: float) -> float:
    return BASE_LAT + meters / M_PER_DEG_LAT


@pytest.fixture()
def synthetic_network(tmp_path: Path) -> RoadNetwork:
    """One east-west trunk with a lanes tag, one residential without."""
    doc = {
        "ways": [
            {
                "c": "trunk",
                "l": 6,
                "n": "Test Trunk Road",
                "g": [[BASE_LAT, BASE_LNG], [BASE_LAT, BASE_LNG + 0.01]],
            },
            {
                "c": "residential",
                "g": [
                    [_lat_offset(500), BASE_LNG],
                    [_lat_offset(500), BASE_LNG + 0.01],
                ],
            },
        ]
    }
    path = tmp_path / "roads.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh)
    return RoadNetwork(path)


# --- geometry -------------------------------------------------------------


def test_point_segment_distance_clamps_to_the_segment_ends():
    # P is beyond B, so the nearest point is B itself, not the infinite line.
    assert _point_segment_distance_m(10.0, 0.0, 0.0, 0.0, 5.0, 0.0) == pytest.approx(5.0)
    # Perpendicular foot lands inside the segment.
    assert _point_segment_distance_m(2.0, 3.0, 0.0, 0.0, 5.0, 0.0) == pytest.approx(3.0)


def test_point_segment_distance_handles_a_degenerate_segment():
    """A way with two identical vertices must not divide by zero."""
    assert _point_segment_distance_m(3.0, 4.0, 1.0, 1.0, 1.0, 1.0) == pytest.approx(
        (2.0**2 + 3.0**2) ** 0.5
    )


# --- resolution -----------------------------------------------------------


def test_matches_the_nearest_way_and_reads_its_osm_lane_count(synthetic_network):
    match = synthetic_network.nearest(_lat_offset(10), BASE_LNG + 0.005)
    assert match is not None
    assert match.road_type == "trunk"
    assert match.total_lanes == 6           # from the OSM `lanes` tag
    assert match.lanes_source == "osm"
    assert match.name == "Test Trunk Road"
    assert match.distance_m == pytest.approx(10.0, abs=1.0)


def test_falls_back_to_the_class_default_when_osm_has_no_lanes_tag(synthetic_network):
    match = synthetic_network.nearest(_lat_offset(505), BASE_LNG + 0.005)
    assert match is not None
    assert match.road_type == "residential"
    assert match.total_lanes == CLASS_DEFAULT_LANES["residential"]
    assert match.lanes_source == "class_default"


def test_returns_nothing_beyond_the_match_cutoff(synthetic_network):
    assert synthetic_network.nearest(_lat_offset(10), BASE_LNG + 0.005) is not None
    far = synthetic_network.nearest(_lat_offset(MATCH_CUTOFF_M + 200), BASE_LNG + 0.005)
    assert far is None or far.road_type == "residential"
    # Straight out to sea, nowhere near either way.
    assert synthetic_network.nearest(BASE_LAT - 1.0, BASE_LNG - 1.0) is None


def test_missing_dataset_degrades_instead_of_raising(tmp_path):
    absent = RoadNetwork(tmp_path / "does-not-exist.json.gz")
    assert absent.available is False
    assert absent.nearest(BASE_LAT, BASE_LNG) is None


def test_committed_colombo_dataset_resolves_a_real_road():
    """Guards the committed data file, not just the algorithm."""
    if not network.available:
        pytest.skip("colombo_roads.json.gz not present")
    from src.roads import resolve

    fort = resolve(6.9344, 79.8428)  # Colombo Fort
    assert fort["source"] == "osm"
    assert fort["road_type"] in CLASS_DEFAULT_LANES
    assert fort["distance_m"] <= MATCH_CUTOFF_M


# --- API integration ------------------------------------------------------


BODY = {
    "latitude": 6.9344,
    "longitude": 79.8428,
    "lanes_blocked": 1,
    "incident_type": "engine_failure",
    "hour": 8,
    "day_of_week": 0,
}


def test_score_accepts_a_request_with_no_road_fields_at_all():
    """This is what dispatch now sends: a GPS fix and nothing about the road."""
    res = client.post("/v1/score", json=BODY)
    assert res.status_code == 200, res.text
    road = res.json()["road"]
    assert road["source"] in {"osm", "default"}
    assert road["road_type"]
    assert road["total_lanes"] >= 1


def test_unresolvable_location_reproduces_the_historical_hardcoded_values():
    """The behaviour-preserving guarantee: a miss scores as it always did."""
    res = client.post("/v1/score", json={**BODY, "latitude": 0.0, "longitude": 0.0})
    assert res.status_code == 200, res.text
    road = res.json()["road"]
    assert road["source"] == "default"
    assert road["road_type"] == FALLBACK_ROAD_TYPE
    assert road["total_lanes"] == FALLBACK_TOTAL_LANES


def test_caller_supplied_road_is_believed_and_reported_as_such():
    res = client.post("/v1/score", json={**BODY, "road_type": "motorway", "total_lanes": 6})
    assert res.status_code == 200, res.text
    road = res.json()["road"]
    assert road == {
        "road_type": "motorway",
        "total_lanes": 6,
        "source": "request",
        "lanes_source": "request",
        "matched_road": None,
        "distance_m": None,
        "lanes_blocked_clamped": False,
    }


def test_caller_supplied_lane_overflow_is_still_rejected():
    """Their numbers, their error — the 400 must not be softened away."""
    res = client.post("/v1/score", json={**BODY, "road_type": "residential",
                                         "total_lanes": 2, "lanes_blocked": 3})
    assert res.status_code == 400
    assert "lanes_blocked" in res.json()["detail"]


def test_server_resolved_lane_overflow_is_clamped_not_rejected():
    """Dispatch derives lanes_blocked from the triaged service type and cannot know
    the true lane count. Rejecting would break the spine on every narrow road."""
    res = client.post("/v1/score", json={**BODY, "latitude": 0.0, "longitude": 0.0,
                                         "lanes_blocked": 5})
    assert res.status_code == 200, res.text
    road = res.json()["road"]
    assert road["lanes_blocked_clamped"] is True
    assert res.json()["factors"]["capacity_loss"] == pytest.approx(1.0)


def test_resolution_moves_the_location_factor_off_its_old_constant():
    """The whole point: LF must now vary with position instead of sitting at
    ROAD_LOCATION_FACTOR['primary'] = 0.70 for every incident in the country."""
    if not network.available:
        pytest.skip("colombo_roads.json.gz not present")
    seen = set()
    for lat, lng in [(6.9344, 79.8428), (6.9110, 79.8487), (6.8649, 79.8997),
                     (6.9271, 79.8612), (6.8890, 79.9190)]:
        res = client.post("/v1/score", json={**BODY, "latitude": lat, "longitude": lng})
        assert res.status_code == 200, res.text
        seen.add(res.json()["factors"]["location"])
    assert len(seen) > 1, f"location factor still constant across Colombo: {seen}"
