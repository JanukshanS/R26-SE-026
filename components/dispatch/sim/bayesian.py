"""
============================================================================
Bayesian — Python port of the TypeScript Dirichlet-Multinomial engine
============================================================================

Mirrors `components/dispatch/src/services/bayesian-engine.ts` exactly:
symptom-key hashing, discounted Dirichlet-Multinomial update, and the
count-weighted blend at inference time.

The TypeScript version is unit-tested in the dispatch service and its
reference tests reproduce this file's convergence numbers. If you tune
anything here, tune the same constant in the TS file — the whole point
of the simulation is that its results predict production behaviour.

MODEL
-----
Per symptom key, maintain a Dirichlet pseudo-count vector α_x of
length K = 19 (ML classes), initialised to α_0 = 0.5 (Jeffreys prior).
On each resolution outcome k*:
    α_x,k <- gamma * α_x,k + 1[k == k*]     for all k, gamma = 0.99
    P_prior(k | x) = α_x,k / sum(α_x)

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field


# ─── Discounted Dirichlet-Multinomial constants (mirror TS) ──────────────
DISCOUNT_FACTOR           = 0.99   # gamma
INITIAL_ALPHA_PSEUDOCOUNT = 0.5    # Jeffreys prior

# ─── Blend constants (unchanged from v1) ─────────────────────────────────
TREE_EFFECTIVE_WEIGHT     = 20   # K in (K*tree + n*prior) / (K+n)
MIN_OBSERVATIONS_TO_BLEND = 3    # below this the blend is a no-op

# ─── Symptom-key fields (mirror utils/symptom-key.ts) ────────────────────
KEY_FIELDS = [
    "Q1_intent",
    "Q2_engine_start",
    "Q3_sound",
    "Q_brake_detail",
    "Q7_overheat_detail",
]


# ─────────────────────────────────────────────────────────────────────────
# Symptom key
# ─────────────────────────────────────────────────────────────────────────

def compute_symptom_key(responses: dict[str, str]) -> str:
    """Canonical hash of the five discriminating triage fields."""
    parts = [f"{f}={responses.get(f)}" for f in KEY_FIELDS]
    digest = hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]
    return f"sk_{digest}"


# ─────────────────────────────────────────────────────────────────────────
# Pure Dirichlet-Multinomial functions
# ─────────────────────────────────────────────────────────────────────────

def initial_dirichlet_counts(classes: list[str]) -> dict[str, float]:
    """A fresh Jeffreys-uniform Dirichlet count vector over `classes`."""
    return {c: INITIAL_ALPHA_PSEUDOCOUNT for c in classes}


def update_dirichlet_counts(
    counts: dict[str, float],
    actual: str,
    gamma: float = DISCOUNT_FACTOR,
) -> dict[str, float]:
    """
    Apply one observation to the count vector.

        α_k  <-  gamma * α_k + 1[k = actual]

    Returns a NEW dict; input not mutated.
    """
    if not 0 <= gamma <= 1:
        raise ValueError(f"gamma must be in [0,1], got {gamma}")
    out = {c: gamma * v for c, v in counts.items()}
    if actual in out:
        out[actual] += 1.0
    return out


def posterior_from_counts(counts: dict[str, float]) -> dict[str, float]:
    """Normalise the count vector to a probability distribution."""
    total = sum(counts.values())
    if total <= 0:
        p = 1.0 / len(counts) if counts else 0.0
        return {c: p for c in counts}
    return {c: v / total for c, v in counts.items()}


def normalise(dist: dict[str, float]) -> dict[str, float]:
    """Scale so probabilities sum to 1. Defensive against float drift."""
    total = sum(dist.values())
    if total <= 0:
        p = 1.0 / len(dist) if dist else 0.0
        return {c: p for c in dist}
    return {c: v / total for c, v in dist.items()}


def shannon_entropy(dist: dict[str, float]) -> float:
    """Entropy in bits. 0 = certain; log2(K) = uniform over K classes."""
    h = 0.0
    for p in dist.values():
        if p > 0:
            h -= p * math.log2(p)
    return h


def blend_prior_with_tree(
    tree_probs:               dict[str, float],
    prior_probs:              dict[str, float],
    prior_observation_count:  int,
    k_weight:                 float = TREE_EFFECTIVE_WEIGHT,
) -> tuple[dict[str, float], bool]:
    """
    Count-weighted blend: P_final = (K*tree + n*prior) / (K + n).

    Returns (blended, was_actually_blended). The bool is False when
    n < MIN_OBSERVATIONS_TO_BLEND — in that case the tree distribution
    is returned unchanged and the caller should NOT mark the result as
    bayesian-influenced. `k_weight` overrides K for sensitivity analysis;
    default matches TREE_EFFECTIVE_WEIGHT (production value).
    """
    if prior_observation_count < MIN_OBSERVATIONS_TO_BLEND:
        return tree_probs, False
    K = k_weight
    n = prior_observation_count
    denom = K + n
    all_keys = set(tree_probs.keys()) | set(prior_probs.keys())
    out = {
        k: (K * tree_probs.get(k, 0.0) + n * prior_probs.get(k, 0.0)) / denom
        for k in all_keys
    }
    return normalise(out), True


def argmax(dist: dict[str, float]) -> tuple[str, float]:
    """Argmax with stable tie-break by insertion order."""
    best_k, best_v = "", -math.inf
    for k, v in dist.items():
        if v > best_v:
            best_k, best_v = k, v
    return best_k, best_v


# ─────────────────────────────────────────────────────────────────────────
# Stateful store — the simulation's in-memory version of bayesian_priors
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class StoredPrior:
    symptom_key:            str
    alpha:                  dict[str, float]   # Dirichlet counts vector
    observation_count:      int = 0            # real n_x


class InMemoryPriorStore:
    """
    Dict-backed analogue of the Postgres `bayesian_priors` table using the
    v3 Dirichlet-Multinomial formulation. No persistence — one instance
    per simulation run, so seeds fully control state.
    """

    def __init__(
        self,
        class_names: list[str],
        gamma:       float = DISCOUNT_FACTOR,
        k_weight:    float = TREE_EFFECTIVE_WEIGHT,
    ):
        self._class_names = class_names
        self._store: dict[str, StoredPrior] = {}
        self.gamma    = gamma       # overridable for sensitivity analysis
        self.k_weight = k_weight    # overridable for sensitivity analysis

    def get(self, key: str) -> StoredPrior | None:
        return self._store.get(key)

    def apply_feedback(self, key: str, actual: str) -> StoredPrior:
        existing = self._store.get(key)
        old_alpha = existing.alpha if existing else initial_dirichlet_counts(self._class_names)
        old_n     = existing.observation_count if existing else 0
        new_alpha = update_dirichlet_counts(old_alpha, actual, self.gamma)
        stored = StoredPrior(
            symptom_key       = key,
            alpha             = new_alpha,
            observation_count = old_n + 1,
        )
        self._store[key] = stored
        return stored

    def blend_for(
        self,
        key: str,
        tree_probs: dict[str, float],
    ) -> tuple[dict[str, float], bool]:
        stored = self._store.get(key)
        if stored is None:
            return tree_probs, False
        prior_probs = posterior_from_counts(stored.alpha)
        return blend_prior_with_tree(tree_probs, prior_probs, stored.observation_count, self.k_weight)

    # ── Aggregate stats for the convergence plot ──────────────────────

    def average_entropy(self) -> float:
        if not self._store:
            return 0.0
        return sum(
            shannon_entropy(posterior_from_counts(p.alpha))
            for p in self._store.values()
        ) / len(self._store)

    def total_observations(self) -> int:
        return sum(p.observation_count for p in self._store.values())

    def distinct_keys(self) -> int:
        return len(self._store)
