"""The advice rules and the crowd-sourced price benchmark.

The advice tests exist because these strings are the only thing standing
between a worn brake pad and a driver who thinks it is fine. They assert
BEHAVIOUR - that severity is never understated - rather than exact wording, so
the copy can be reworded without the tests becoming noise.

The price tests protect a number that looks authoritative on screen. A median
skewed by one mistyped invoice is worse than showing nothing at all, because a
driver would believe it.
"""
from __future__ import annotations

import uuid

import pytest

from app.advice import build_advice
from app.routers.marketplace import (
    MIN_OBSERVATIONS_FOR_RANGE,
    _haversine_km,
    _percentile,
    observed_prices,
)


# ── Advice: severity must never be understated ────────────────────────────

def test_worn_out_component_is_critical():
    a = build_advice("brake", health_pct=8.0, status="Critical",
                     predicted_rul_km=200, max_lifespan_km=40000)
    assert a.urgency == "critical"
    # The headline alone has to carry the message: it is what shows collapsed.
    assert "now" in a.headline.lower() or "attention" in a.headline.lower()
    assert a.actions, "a critical component must always offer a next step"


def test_healthy_component_is_not_alarming():
    a = build_advice("tire", health_pct=92.0, status="Good",
                     predicted_rul_km=46000, max_lifespan_km=50000)
    assert a.urgency == "healthy"
    assert "no action" in " ".join(a.actions).lower()


def test_urgency_scales_with_the_components_own_life():
    """A big job earns MORE warning distance, not less.

    The same 10,000 km remaining is comfortable on brake pads (rated 40,000)
    but already worth planning for on an engine (rated 150,000) - replacing an
    engine is neither quick nor cheap, so the warning has to arrive earlier in
    absolute kilometres. A single shared threshold could not express that.

    Note this is NOT saying an engine tolerates a low remaining life: 2,000 km
    left is critical on anything. It is saying the thresholds sit at different
    distances.
    """
    brake = build_advice("brake", 80.0, "Good", 10000, 40000)
    engine = build_advice("engine", 80.0, "Good", 10000, 150000)
    assert brake.urgency == "healthy", "10,000 km is plenty on a 40,000 km part"
    assert engine.urgency == "soon", "10,000 km on a 150,000 km engine is planning territory"


def test_very_low_remaining_life_is_critical_on_every_component():
    """Whatever the part, nearly-gone is nearly-gone."""
    for comp, life in [("engine", 150000), ("brake", 40000), ("tire", 50000), ("battery", 80000)]:
        a = build_advice(comp, 15.0, "Critical", 300, life)
        assert a.urgency == "critical", f"{comp} with 300 km left was not critical"


def test_overdue_oil_overrides_a_healthy_engine():
    """The engine is fine; the oil is not. The driver still needs telling."""
    a = build_advice("engine", health_pct=90.0, status="Good",
                     predicted_rul_km=130000, max_lifespan_km=150000,
                     oil_overdue=True)
    assert a.urgency == "critical"
    assert any("oil" in x.lower() for x in a.actions)


def test_no_data_never_invents_a_verdict():
    a = build_advice("battery", 0.0, "No data", 0, 80000)
    assert a.urgency == "unknown"
    # Must not imply health either way.
    assert "good shape" not in a.headline.lower()
    assert any("adapter" in x.lower() or "drive" in x.lower() for x in a.actions)


def test_estimated_inputs_are_disclosed():
    """A guess presented as a finding is the failure mode that matters here."""
    a = build_advice("brake", 40.0, "Fair", 9000, 40000,
                     is_estimated=True, baseline_basis="inferred_schedule")
    assert a.is_estimated is True
    assert any("estimat" in r.lower() or "approxim" in r.lower() for r in a.reasons)


def test_reasons_are_always_given():
    """Every conclusion has to be checkable against a number on the screen."""
    for comp, life in [("engine", 150000), ("brake", 40000), ("tire", 50000), ("battery", 80000)]:
        a = build_advice(comp, 50.0, "Fair", life * 0.2, life)
        assert a.reasons, f"{comp} produced no reasoning"
        assert any("%" in r for r in a.reasons), f"{comp} never cites the health figure"


def test_headline_grammar_matches_the_label():
    """"Engine need attention" reads as broken software, not a diagnosis."""
    singular = build_advice("engine", 10.0, "Critical", 100, 150000)
    plural = build_advice("brake", 10.0, "Critical", 100, 40000)
    assert "Engine needs" in singular.headline
    assert "Brake pads need" in plural.headline


# ── Price benchmark ────────────────────────────────────────────────────────

class _FakeQuery:
    def __init__(self, values):
        self._values = values

    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return [(v,) for v in self._values]


class _FakeDb:
    """Stands in for a Session; observed_prices only ever reads one column."""

    def __init__(self, values):
        self._values = values

    def query(self, *_args, **_kwargs):
        return _FakeQuery(self._values)


def test_too_few_observations_is_reported_as_unreliable():
    """One driver's invoice is an anecdote, and must not be shown as typical."""
    db = _FakeDb([12000.0])
    out = observed_prices(db, "brake")
    assert out.is_reliable is False
    assert out.low_lkr is None and out.median_lkr is None
    assert out.sample_size == 1


def test_range_appears_once_there_is_enough_evidence():
    db = _FakeDb([11000.0, 12000.0, 12500.0, 13000.0, 14000.0])
    out = observed_prices(db, "brake")
    assert out.is_reliable is True
    assert out.sample_size == 5
    assert out.low_lkr <= out.median_lkr <= out.high_lkr


def test_implausible_values_are_discarded():
    """A mistyped invoice would otherwise define the median for everyone."""
    # Four sane brake-pad prices plus a whole-car-purchase typo and a 5 rupee one.
    db = _FakeDb([12000.0, 12500.0, 13000.0, 12800.0, 9_999_999.0, 5.0])
    out = observed_prices(db, "brake")
    assert out.sample_size == 4, "outliers should have been dropped before counting"
    assert out.high_lkr < 100_000


def test_percentiles_ignore_a_single_extreme():
    """p10/p90 rather than min/max, so one outlier cannot set the range."""
    values = [10000.0] * 9 + [500000.0]
    db = _FakeDb(values)
    out = observed_prices(db, "brake")
    assert out.is_reliable
    # The 500k job is real data and stays in the sample, but must not become
    # the advertised upper bound.
    assert out.high_lkr < 500000.0


def test_min_observations_constant_is_actually_enforced():
    db = _FakeDb([10000.0] * (MIN_OBSERVATIONS_FOR_RANGE - 1))
    assert observed_prices(db, "brake").is_reliable is False
    db = _FakeDb([10000.0] * MIN_OBSERVATIONS_FOR_RANGE)
    assert observed_prices(db, "brake").is_reliable is True


# ── Distance ───────────────────────────────────────────────────────────────

def test_haversine_matches_a_known_distance():
    """Colombo to Kandy is about 94 km straight line."""
    km = _haversine_km(6.9271, 79.8612, 7.2906, 80.6337)
    assert 90 < km < 100


def test_distance_to_self_is_zero():
    assert _haversine_km(6.9271, 79.8612, 6.9271, 79.8612) == pytest.approx(0.0, abs=1e-6)


def test_percentile_edges():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert _percentile(values, 0.0) == 1.0
    assert _percentile(values, 1.0) == 5.0
    assert _percentile([], 0.5) == 0.0


# ── Fitment ────────────────────────────────────────────────────────────────

class _FakePart:
    """Only the three fields part_fits_vehicle actually reads."""

    def __init__(self, fits_models=None, fits_any_model=0):
        self.fits_models = fits_models
        self.fits_any_model = fits_any_model


def test_a_part_for_another_car_is_never_offered():
    """The failure this guards against: Honda pads recommended to an Aqua."""
    from app.routers.marketplace import part_fits_vehicle
    honda = _FakePart("honda city,honda grace")
    assert part_fits_vehicle(honda, "Toyota Aqua") is False


def test_an_exact_model_match_is_offered():
    from app.routers.marketplace import part_fits_vehicle
    aqua = _FakePart("toyota aqua,toyota prius c")
    assert part_fits_vehicle(aqua, "Toyota Aqua") is True


def test_marque_wide_parts_match_any_model_of_that_marque():
    """Engine oil listed as "Toyota Vehicles" fits an Aqua."""
    from app.routers.marketplace import part_fits_vehicle
    oil = _FakePart("toyota", fits_any_model=1)
    assert part_fits_vehicle(oil, "Toyota Aqua") is True
    assert part_fits_vehicle(oil, "Honda Civic") is False


def test_model_specific_parts_do_not_leak_across_the_marque():
    """Corolla spark plugs must not match every Toyota ever made."""
    from app.routers.marketplace import part_fits_vehicle
    corolla_only = _FakePart("toyota corolla,toyota axio", fits_any_model=0)
    assert part_fits_vehicle(corolla_only, "Toyota Aqua") is False
    assert part_fits_vehicle(corolla_only, "Toyota Corolla") is True


def test_unknown_fitment_is_not_assumed_compatible():
    """An unknown must not be presented as a match."""
    from app.routers.marketplace import part_fits_vehicle
    unknown = _FakePart(None, fits_any_model=0)
    assert part_fits_vehicle(unknown, "Toyota Aqua") is False


def test_no_vehicle_known_means_no_filtering():
    """With nothing to match against, return everything rather than nothing."""
    from app.routers.marketplace import part_fits_vehicle
    honda = _FakePart("honda city")
    assert part_fits_vehicle(honda, None) is True
