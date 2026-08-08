import math
from src.impact_scoring import ImpactScoringModel, IncidentInput, PriorityLevel

def test_default_weights_match_contract():
    m = ImpactScoringModel()
    assert set(m.WEIGHTS) == {"capacity_loss","traffic_volume","temporal","location","incident_severity"}
    assert math.isclose(sum(m.WEIGHTS.values()), 1.0, abs_tol=1e-9)
    assert m.WEIGHTS["capacity_loss"] == 0.25
    assert m.WEIGHTS["incident_severity"] == 0.15

def test_score_in_range_with_valid_priority():
    m = ImpactScoringModel()
    inc = IncidentInput(latitude=6.9271, longitude=79.8612, road_type="primary", total_lanes=2, lanes_blocked=1, incident_type="accident_major", hour=8, day_of_week=0, speed_limit_kmh=60.0)
    r = m.score(inc)
    assert 1.0 <= r.score <= 10.0
    assert isinstance(r.priority, PriorityLevel)
    for f in (r.capacity_loss_factor, r.traffic_volume_factor, r.temporal_factor, r.location_factor, r.incident_severity_factor):
        assert 0.0 <= f <= 1.0

def test_more_blocked_lanes_never_lowers_score():
    m = ImpactScoringModel()
    base = dict(latitude=6.9, longitude=79.8, road_type="primary", total_lanes=3, incident_type="accident_major", hour=8, day_of_week=0, speed_limit_kmh=60.0)
    assert m.score(IncidentInput(lanes_blocked=2, **base)).score >= m.score(IncidentInput(lanes_blocked=1, **base)).score


# ponytail: golden scores instead of importing RP/src/impact_scoring.py — a hard path
# to the research tree would break CI. These values are the deployed RP model's output;
# if either tree's weights or lookup tables drift, this fails. Regenerate only alongside
# data/sumo_results.csv and the thesis numbers.
def test_deployed_weights_fully_pinned():
    w = ImpactScoringModel().WEIGHTS
    assert w == {"capacity_loss": 0.25, "traffic_volume": 0.25,
                 "temporal": 0.20, "location": 0.15, "incident_severity": 0.15}


def test_golden_scores_match_research_pipeline():
    m = ImpactScoringModel()
    cases = [
        # (road_type, total_lanes, lanes_blocked, incident_type, hour, dow), expected score
        (("motorway", 4, 2, "accident_major", 8, 0), 8.6),
        (("trunk", 2, 1, "flat_tire", 17, 2), 7.0),
        (("primary", 2, 1, "engine_failure", 12, 1), 6.0),
        (("residential", 2, 1, "flat_tire", 23, 4), 2.2),
        (("secondary", 2, 1, "accident_minor", 8, 0), 6.5),
    ]
    for (road, lanes, blocked, itype, hour, dow), expected in cases:
        got = m.score(IncidentInput(6.9, 79.86, road, lanes, blocked, itype, hour, dow)).score
        assert got == expected, f"{road}/{itype}@{hour}h: expected {expected}, got {got}"


def test_scoring_meets_nfr01_latency_budget():
    """NFR-01: a score must be produced well inside the 500 ms budget."""
    import time
    m = ImpactScoringModel()
    inc = IncidentInput(6.9271, 79.8612, "primary", 2, 1, "accident_major", 8, 0)
    m.score(inc)  # warm up import-time lookups
    t0 = time.perf_counter()
    for _ in range(100):
        m.score(inc)
    per_call_ms = (time.perf_counter() - t0) * 1000 / 100
    assert per_call_ms < 500.0, f"score() took {per_call_ms:.3f} ms/call, NFR-01 budget is 500 ms"
