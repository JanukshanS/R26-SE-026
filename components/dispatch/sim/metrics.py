"""
============================================================================
Metrics — per-incident logs, aggregate stats, paired t-tests
============================================================================

For each strategy we log one row per incident. Aggregation produces a
metrics table + statistical significance tests comparing UADO to each
baseline.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, asdict
from pathlib import Path
from statistics import mean, stdev
from typing import Any

from .ecm import (
    AVERAGE_SERVICE_TIMES,
    RE_DISPATCH_PENALTY_MINUTES,
    haversine_km,
    travel_time_min,
)
from .scenario import Incident


# ─── Per-incident log ────────────────────────────────────────────────────

@dataclass
class DispatchLog:
    strategy:               str
    incident_id:            str
    incident_index:         int      # 0..N-1, for time-series plots
    true_service_type:      str
    predicted_service_type: str
    provider_id:            str
    provider_capable:       bool     # did the assigned provider have the true capability?
    matched:                bool     # predicted == true (a proxy for successful dispatch)
    resolution_time_min:    float    # travel + service + (re-dispatch penalty if mismatched)
    was_re_dispatched:      bool
    posterior_entropy_bits: float | None   # UADO only — for convergence curve


# ─── Simulate one dispatch outcome ───────────────────────────────────────

def score_dispatch(
    incident:               Incident,
    predicted_service_type: str,
    chosen_provider:        Any,
    strategy_name:          str,
    incident_index:         int,
    posterior_entropy_bits: float | None = None,
) -> DispatchLog:
    """
    Given who was picked and what was predicted, roll forward the
    consequences and produce a DispatchLog row.

    Resolution time model:
      base = travel_time + service_time_for(true_type)
      if provider can handle the true type → resolved directly, cost=base
      else → re-dispatch: cost = base + RE_DISPATCH_PENALTY (a 2nd provider
             arrives; we don't model who they were, just the aggregate delay)
    """
    travel = travel_time_min(
        haversine_km(chosen_provider.latitude, chosen_provider.longitude,
                     incident.latitude, incident.longitude)
    )
    true_service = AVERAGE_SERVICE_TIMES.get(incident.true_service_type, 60)
    capable      = incident.true_service_type in chosen_provider.capabilities
    resolution   = travel + true_service + (0 if capable else RE_DISPATCH_PENALTY_MINUTES)

    return DispatchLog(
        strategy               = strategy_name,
        incident_id            = incident.id,
        incident_index         = incident_index,
        true_service_type      = incident.true_service_type,
        predicted_service_type = predicted_service_type,
        provider_id            = chosen_provider.id,
        provider_capable       = capable,
        matched                = predicted_service_type == incident.true_service_type,
        resolution_time_min    = resolution,
        was_re_dispatched      = not capable,
        posterior_entropy_bits = posterior_entropy_bits,
    )


# ─── Aggregation ─────────────────────────────────────────────────────────

@dataclass
class StrategySummary:
    strategy:                     str
    n_incidents:                  int
    match_rate:                   float     # predicted == true
    provider_capable_rate:        float     # chosen provider CAN do the true job
    re_dispatch_rate:             float
    avg_resolution_time_min:      float
    stdev_resolution_time_min:    float


def summarise(logs: list[DispatchLog], strategy_name: str) -> StrategySummary:
    subset = [l for l in logs if l.strategy == strategy_name]
    if not subset:
        return StrategySummary(strategy_name, 0, 0, 0, 0, 0, 0)
    n = len(subset)
    return StrategySummary(
        strategy                  = strategy_name,
        n_incidents               = n,
        match_rate                = sum(1 for l in subset if l.matched)          / n,
        provider_capable_rate     = sum(1 for l in subset if l.provider_capable) / n,
        re_dispatch_rate          = sum(1 for l in subset if l.was_re_dispatched)/ n,
        avg_resolution_time_min   = mean(l.resolution_time_min for l in subset),
        stdev_resolution_time_min = stdev([l.resolution_time_min for l in subset]) if n > 1 else 0.0,
    )


# ─── Paired t-test ───────────────────────────────────────────────────────

def paired_t_test(a: list[float], b: list[float]) -> tuple[float, float]:
    """
    Simple paired t-test (equal-length, per-incident matched samples).
    Returns (t_statistic, two_sided_p_value_approx).

    p-value uses a normal approximation of the t distribution — fine for
    large N (which is what we have with 500-1000 incidents). SciPy would
    give an exact value; we intentionally avoid the dep for a self-
    contained simulation module.
    """
    if len(a) != len(b) or len(a) < 2:
        return math.nan, math.nan
    d = [ai - bi for ai, bi in zip(a, b)]
    n = len(d)
    mean_d = sum(d) / n
    var_d  = sum((x - mean_d)**2 for x in d) / (n - 1) if n > 1 else 0.0
    if var_d == 0:
        return math.nan if mean_d == 0 else math.copysign(math.inf, mean_d), 0.0 if mean_d != 0 else 1.0
    se = math.sqrt(var_d / n)
    t  = mean_d / se
    # 2-sided p via normal approx (df large so t ≈ z)
    z = abs(t)
    # Abramowitz & Stegun approximation of the standard normal CDF
    p = 2 * (1 - _std_normal_cdf(z))
    return t, p


def _std_normal_cdf(z: float) -> float:
    """Zelen & Severo approximation — max error ~7.5e-8, no dep required."""
    if z < 0:
        return 1 - _std_normal_cdf(-z)
    t = 1.0 / (1.0 + 0.2316419 * z)
    pd = (1.0 / math.sqrt(2*math.pi)) * math.exp(-z*z / 2)
    return 1 - pd * (
          0.319381530 * t
        - 0.356563782 * t**2
        + 1.781477937 * t**3
        - 1.821255978 * t**4
        + 1.330274429 * t**5
    )


# ─── McNemar's test — appropriate for BINARY paired outcomes ─────────────
#
# Paired t-test on binary variables (match / no-match) is not the right
# tool because the assumption of continuous outcomes is violated and
# small-N behavior is poor. McNemar's chi-square uses only the DISCORDANT
# pairs — cases where the two strategies disagreed — which is the correct
# way to compare paired categorical outcomes.

def mcnemars_test(
    strategy_a_matched: list[bool],
    strategy_b_matched: list[bool],
) -> dict[str, float]:
    """
    Continuity-corrected McNemar's test on two per-incident paired
    boolean sequences (True = the strategy predicted the correct class).

    Returns a dict with:
      - b, c            : discordant pair counts (a-wins, b-wins)
      - chi2            : (|b - c| - 1)^2 / (b + c) if b+c > 0 else nan
      - p_value         : 1-df chi-square upper tail — normal approx via
                          the same Zelen & Severo CDF used elsewhere here
      - a_wins_rate     : b / N — fraction of incidents where only A was right
      - b_wins_rate     : c / N — fraction of incidents where only B was right
      - n               : total paired incidents
    """
    if len(strategy_a_matched) != len(strategy_b_matched):
        raise ValueError("McNemar's test requires paired sequences of equal length")
    n = len(strategy_a_matched)
    b = sum(1 for x, y in zip(strategy_a_matched, strategy_b_matched) if x and not y)
    c = sum(1 for x, y in zip(strategy_a_matched, strategy_b_matched) if y and not x)
    if b + c == 0:
        # Perfectly concordant — no statistical evidence of difference.
        return {"b": float(b), "c": float(c), "chi2": math.nan, "p_value": 1.0,
                "a_wins_rate": 0.0, "b_wins_rate": 0.0, "n": float(n)}
    chi2 = (abs(b - c) - 1) ** 2 / (b + c)
    # Upper-tail p-value of χ²_1: 2·(1 - Φ(√χ²)).
    p = 2 * (1 - _std_normal_cdf(math.sqrt(chi2)))
    return {
        "b":           float(b),
        "c":           float(c),
        "chi2":        float(chi2),
        "p_value":     float(p),
        "a_wins_rate": b / n if n else 0.0,
        "b_wins_rate": c / n if n else 0.0,
        "n":           float(n),
    }


# ─── CSV output ──────────────────────────────────────────────────────────

def write_logs_csv(logs: list[DispatchLog], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(DispatchLog.__annotations__.keys()))
        writer.writeheader()
        for l in logs:
            writer.writerow(asdict(l))


def write_summaries_csv(summaries: list[StrategySummary], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(StrategySummary.__annotations__.keys()))
        writer.writeheader()
        for s in summaries:
            row = asdict(s)
            # Round floats to 4 dp for readability
            for k, v in row.items():
                if isinstance(v, float):
                    row[k] = round(v, 4)
            writer.writerow(row)
