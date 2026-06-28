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
