"""
============================================================================
Strategies — 4 dispatch policies exercised on the same incident stream
============================================================================

Each strategy is a callable that maps (incident, providers, state) → chosen
provider. They share NOTHING but their input signature — that isolation is
what makes their comparison meaningful.

STRATEGIES
----------
    UADO             — the full pipeline (tree → ECM → Bayesian blend)
    GreedyNearest    — closest provider, ignoring capabilities
    TypeMatched      — closest provider whose capabilities match tree's argmax
    MultiCriteria    — deterministic weighted score (distance + trust +
                       capability-match) with NO uncertainty or learning

Each strategy also exposes an `observe_feedback(incident, actual)` hook.
Only UADO uses it (Bayesian update); baselines no-op.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .bayesian import (
    InMemoryPriorStore,
    argmax as bayesian_argmax,
    compute_symptom_key,
)
from .ecm import (
    Provider,
    haversine_km,
    rank_providers,
    travel_time_min,
    AVERAGE_SERVICE_TIMES,
)
from .scenario import Incident, ML_SERVICE_TYPES
from .tree_walker import get_tree


# ─── Base class ──────────────────────────────────────────────────────────

class Strategy:
    """
    Abstract base. Subclasses implement `dispatch()` and — if they learn —
    override `observe_feedback()`. Everything else (helpers, state hooks)
    is inherited or shared through instance vars.
    """
    name: str = "base"

    def dispatch(
        self,
        incident:              Incident,
        providers:             list[Provider],
        traffic_impact_score:  float = 5.0,
    ) -> tuple[Provider, str, dict[str, float]]:
        """
        Return (chosen_provider, predicted_service_type, probabilities).
        The `probabilities` dict is used for metrics reporting; strategies
        that don't produce distributions synthesise a one-hot on their
        chosen prediction.
        """
        raise NotImplementedError

    def observe_feedback(self, incident: Incident, actual: str) -> None:
        """No-op by default. UADO overrides to update the Bayesian posterior."""
        pass

    def name_for_report(self) -> str:
        return self.name


# ─── UADO: our production pipeline ───────────────────────────────────────

class UADOStrategy(Strategy):
    """
    Full pipeline:
      1. Pick tier (1 or 2 depending on OBD presence)
      2. Predict via tree → probability distribution
      3. Blend with Bayesian posterior for this symptom key (if any)
      4. Rank providers via ECM cost function → pick argmin
      5. On feedback, update Bayesian posterior
    """
    name = "UADO"

    def __init__(self) -> None:
        self.priors = InMemoryPriorStore(class_names=ML_SERVICE_TYPES)

    def dispatch(
        self,
        incident:              Incident,
        providers:             list[Provider],
        traffic_impact_score:  float = 5.0,
    ) -> tuple[Provider, str, dict[str, float]]:
        # Choose Tier 1 or Tier 2 based on OBD availability
        tier = 2 if incident.obd_data and incident.obd_data.get("available") else 1
        tree = get_tree(tier)

        # Merge questionnaire + OBD (Tier 2) into the tree's input dict
        tree_input = dict(incident.responses)
        if tier == 2 and incident.obd_data:
            for k, v in incident.obd_data.items():
                if k != "available":
                    tree_input[k] = v

        tree_probs = tree.predict_proba(tree_input)

        # Bayesian blend for this symptom pattern (no-op if <3 observations)
        symptom_key = compute_symptom_key(incident.responses)
        blended, _  = self.priors.blend_for(symptom_key, tree_probs)

        # ECM ranking on the blended distribution
        ranked   = rank_providers(providers, incident.latitude, incident.longitude, blended, traffic_impact_score)
        chosen   = next(p for p in providers if p.id == ranked[0].provider_id)
        argmax_c, _ = bayesian_argmax(blended)
        return chosen, argmax_c, blended

    def observe_feedback(self, incident: Incident, actual: str) -> None:
        symptom_key = compute_symptom_key(incident.responses)
        self.priors.apply_feedback(symptom_key, actual)


# ─── Baseline 1: Greedy-Nearest ──────────────────────────────────────────

class GreedyNearestStrategy(Strategy):
    """
    Always dispatch the closest AVAILABLE provider — regardless of whether
    they can handle the fault. Naive baseline; expected worst on match rate
    because a nearby tow truck will happily accept a locksmith call.
    """
    name = "GreedyNearest"

    def dispatch(
        self,
        incident:              Incident,
        providers:             list[Provider],
        traffic_impact_score:  float = 5.0,
    ) -> tuple[Provider, str, dict[str, float]]:
        available = [p for p in providers if p.available]
        chosen = min(
            available,
            key=lambda p: haversine_km(p.latitude, p.longitude, incident.latitude, incident.longitude),
        )
        # No prediction at all — synthesise a one-hot on whatever the tree would
        # have said, so downstream metrics still have SOMETHING to log.
        tree_probs = get_tree(1).predict_proba(incident.responses)
        argmax_c, _ = bayesian_argmax(tree_probs)
        return chosen, argmax_c, {argmax_c: 1.0}


# ─── Baseline 2: Type-Matched-Nearest ────────────────────────────────────

class TypeMatchedNearestStrategy(Strategy):
    """
    Uses the tree's argmax prediction to filter providers by capability, then
    picks the closest one that matches. If no capable provider is available,
    falls back to the closest overall (mismatch → re-dispatch downstream).
    """
    name = "TypeMatched"

    def dispatch(
        self,
        incident:              Incident,
        providers:             list[Provider],
        traffic_impact_score:  float = 5.0,
    ) -> tuple[Provider, str, dict[str, float]]:
        available = [p for p in providers if p.available]
        tier = 2 if incident.obd_data and incident.obd_data.get("available") else 1
        tree = get_tree(tier)
        tree_input = dict(incident.responses)
        if tier == 2 and incident.obd_data:
            for k, v in incident.obd_data.items():
                if k != "available":
                    tree_input[k] = v
        predicted, _ = tree.predict(tree_input)

        capable = [p for p in available if predicted in p.capabilities]
        pool    = capable if capable else available
        chosen  = min(
            pool,
            key=lambda p: haversine_km(p.latitude, p.longitude, incident.latitude, incident.longitude),
        )
        return chosen, predicted, {predicted: 1.0}


# ─── Baseline 3: Multi-Criteria ──────────────────────────────────────────

class MultiCriteriaStrategy(Strategy):
    """
    Deterministic weighted score — NO uncertainty, NO learning.

      score(p) = w_dist * (1 / (1 + travel_min))
              + w_trust * trust_score(p)
              + w_type  * (1 if capable else 0)

    Represents the "industry-standard MADM" baseline. Beats greedy on match
    rate, but has no way to hedge against tree mistakes because it commits
    to the argmax.
    """
    name = "MultiCriteria"

    W_DIST  = 0.4
    W_TRUST = 0.3
    W_TYPE  = 0.3

    def dispatch(
        self,
        incident:              Incident,
        providers:             list[Provider],
        traffic_impact_score:  float = 5.0,
    ) -> tuple[Provider, str, dict[str, float]]:
        available = [p for p in providers if p.available]
        tier = 2 if incident.obd_data and incident.obd_data.get("available") else 1
        tree = get_tree(tier)
        tree_input = dict(incident.responses)
        if tier == 2 and incident.obd_data:
            for k, v in incident.obd_data.items():
                if k != "available":
                    tree_input[k] = v
        predicted, _ = tree.predict(tree_input)

        def score(p: Provider) -> float:
            travel = travel_time_min(haversine_km(p.latitude, p.longitude, incident.latitude, incident.longitude))
            dist_component  = 1.0 / (1.0 + travel)
            trust_component = p.trust_score
            type_component  = 1.0 if predicted in p.capabilities else 0.0
            return (self.W_DIST * dist_component
                  + self.W_TRUST * trust_component
                  + self.W_TYPE * type_component)

        chosen = max(available, key=score)
        return chosen, predicted, {predicted: 1.0}
