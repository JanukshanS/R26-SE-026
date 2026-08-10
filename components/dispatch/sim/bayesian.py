"""
============================================================================
Bayesian — Python port of the TS runtime's posterior update logic
============================================================================

Mirrors `components/dispatch/src/services/bayesian-engine.ts` exactly:
symptom-key derivation, learning-rate decay, prior update, and the
count-weighted blend at inference time.

The TypeScript version is unit-tested in the dispatch service; this port
keeps the SAME formulas so simulation results transfer directly to
production behaviour. If you tune anything here, tune the same constant in
the TS file — the whole point of the simulation is that its results predict
what the real system will do.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field


# ─── Config mirrors src/config/index.ts (bayesian.*) ─────────────────────
INITIAL_LEARNING_RATE = 0.1
MIN_LEARNING_RATE     = 0.01
WINDOW_SIZE           = 100

# ─── Blend constants mirror bayesian-engine.ts ───────────────────────────
TREE_EFFECTIVE_WEIGHT     = 20   # K in the (K·tree + n·prior) blend
MIN_OBSERVATIONS_TO_BLEND = 3    # below this, Bayesian is a no-op

# ─── The five KEY_FIELDS mirror utils/symptom-key.ts ─────────────────────
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
# Pure functions (no I/O)
# ─────────────────────────────────────────────────────────────────────────

def compute_learning_rate(observation_count: int) -> float:
    """Linear decay from INITIAL to MIN across WINDOW_SIZE observations."""
    if observation_count <= 0:
        return INITIAL_LEARNING_RATE
    decayed = INITIAL_LEARNING_RATE - observation_count * (
        INITIAL_LEARNING_RATE - MIN_LEARNING_RATE
    ) / WINDOW_SIZE
    return max(MIN_LEARNING_RATE, decayed)


def uniform_prior(classes: list[str]) -> dict[str, float]:
    """Fresh uniform distribution across `classes`."""
    p = 1.0 / len(classes)
    return {c: p for c in classes}


def normalise(dist: dict[str, float]) -> dict[str, float]:
    """Scale so probabilities sum to 1. Defends against float drift + zero-sums."""
    total = sum(dist.values())
    if total <= 0:
        return uniform_prior(list(dist.keys()))
    return {k: v / total for k, v in dist.items()}


def shannon_entropy(dist: dict[str, float]) -> float:
    """Entropy in bits. 0 = certain; log2(K) = uniform over K classes."""
    h = 0.0
    for p in dist.values():
        if p > 0:
            h -= p * math.log2(p)
    return h


def update_prior(
    old: dict[str, float],
    actual: str,
    alpha: float,
) -> dict[str, float]:
    """
    P_new = (1 - alpha) * P_old + alpha * one_hot(actual)
    Mirrors the TS runtime exactly.
    """
    if not 0 <= alpha <= 1:
        raise ValueError(f"alpha out of [0,1]: {alpha}")
    one_minus = 1 - alpha
    out = {c: one_minus * old[c] for c in old}
    if actual in out:
        out[actual] += alpha
    return normalise(out)


def blend_prior_with_tree(
    tree_probs:               dict[str, float],
    prior_probs:              dict[str, float],
    prior_observation_count:  int,
) -> tuple[dict[str, float], bool]:
    """
    Count-weighted blend: P_final = (K·tree + n·prior) / (K + n)

    Returns (blended_distribution, was_actually_blended). The bool is False
    when observation count is below the trust threshold — in that case the
    tree distribution is returned unchanged and the caller should NOT mark
    the result as bayesian-influenced.
    """
    if prior_observation_count < MIN_OBSERVATIONS_TO_BLEND:
        return tree_probs, False

    K = TREE_EFFECTIVE_WEIGHT
    n = prior_observation_count
    denom = K + n
    # Take the union of keys so we don't drop classes present in only one.
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
# Stateful store (in-memory) — the simulation's version of the DB table
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class StoredPrior:
    symptom_key:            str
    probabilities:          dict[str, float]
    observation_count:      int = 0
    current_learning_rate:  float = INITIAL_LEARNING_RATE


class InMemoryPriorStore:
    """
    A dict-based analogue of the Postgres `bayesian_priors` table. Same
    read/update semantics as the DB wrapper in bayesian-service.ts, but
    without persistence — perfect for reproducible simulation runs.
    """

    def __init__(self, class_names: list[str]):
        self._class_names = class_names
        self._store: dict[str, StoredPrior] = {}

    def get(self, key: str) -> StoredPrior | None:
        return self._store.get(key)

    def apply_feedback(self, key: str, actual: str) -> StoredPrior:
        existing = self._store.get(key)
        if existing is None:
            probs = uniform_prior(self._class_names)
            count = 0
        else:
            probs = existing.probabilities
            count = existing.observation_count
        alpha    = compute_learning_rate(count)
        new_prob = update_prior(probs, actual, alpha)
        new_count = count + 1
        stored = StoredPrior(
            symptom_key=key,
            probabilities=new_prob,
            observation_count=new_count,
            current_learning_rate=compute_learning_rate(new_count),
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
        return blend_prior_with_tree(
            tree_probs, stored.probabilities, stored.observation_count
        )

    # ── Aggregate stats — for the convergence plot ────────────────────

    def average_entropy(self) -> float:
        if not self._store:
            return 0.0
        return sum(shannon_entropy(p.probabilities) for p in self._store.values()) / len(self._store)

    def total_observations(self) -> int:
        return sum(p.observation_count for p in self._store.values())

    def distinct_keys(self) -> int:
        return len(self._store)
