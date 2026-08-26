"""
============================================================================
Sensitivity Analysis — M (mismatch penalty), gamma (Bayesian discount),
K (tree/posterior blend weight)
============================================================================

Compact one-parameter-at-a-time robustness sweep, requested to address a
reviewer risk: do the paper's central orderings survive plausible changes
to hardcoded hyperparameters?

    M     in {30, 45, 60} minutes   (baseline 45 — config.dispatch.reDispatchPenaltyMinutes)
    gamma in {0.95, 0.99, 1.0}      (baseline 0.99 — Dirichlet discount factor)
    K     in {10, 20, 40}           (baseline 20 — tree/posterior blend weight)

Baseline appears once; each parameter is varied with the other two held at
baseline (7 unique configs total, not a 27-cell factorial — a full
factorial isn't necessary to answer "does the ordering hold," and the user
explicitly asked for a compact study, not an enormous one).

Three strategies run at every config so both orderings requested can be
checked directly from one report:
    UADO      (full-distribution ECM + Bayesian feedback)
    ECMOnly   (full-distribution ECM, no Bayesian)      -- RQ3 comparator
    ArgmaxECM (one-hot ECM + Bayesian feedback)          -- RQ2 comparator

30 seeds x 1000 incidents x 20 providers per config, same paired design as
the rest of the simulation.

USAGE
-----
    python -m sim.sensitivity

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path
from statistics import mean, stdev

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sim.ecm import Provider                                   # noqa: E402
from sim.scenario import generate_incidents                    # noqa: E402
from sim.strategies import UADOStrategy, ECMOnlyStrategy        # noqa: E402
from sim.ablation_ecm import ArgmaxECMStrategy                  # noqa: E402
from sim.metrics import DispatchLog, mcnemars_test, paired_t_test, score_dispatch, summarise  # noqa: E402
from sim.simulate import _seed_providers                        # noqa: E402

BASELINE = {"M": 45.0, "gamma": 0.99, "K": 20.0}
GRID = {
    "M":     [30.0, 45.0, 60.0],
    "gamma": [0.95, 0.99, 1.0],
    "K":     [10.0, 20.0, 40.0],
}
N_PER_SEED   = 1000
N_SEEDS      = 30
N_PROVIDERS  = 20
BASE_SEED    = 42
TRAFFIC      = 5.0
STRATEGY_NAMES = ["UADO", "ECMOnly", "ArgmaxECM"]


def build_strategies(M: float, gamma: float, K: float):
    return [
        UADOStrategy(gamma=gamma, k_weight=K, re_dispatch_penalty_minutes=M),
        ECMOnlyStrategy(re_dispatch_penalty_minutes=M),
        ArgmaxECMStrategy(gamma=gamma, k_weight=K, re_dispatch_penalty_minutes=M),
    ]


def run_one_seed(seed: int, M: float, gamma: float, K: float) -> list[DispatchLog]:
    incidents = generate_incidents(n=N_PER_SEED, seed=seed)
    provs = _seed_providers(N_PROVIDERS, random.Random(seed + 1))
    strategies = build_strategies(M, gamma, K)

    seed_logs: list[DispatchLog] = []
    for strat in strategies:
        pool = [Provider(**{**p.__dict__, "capabilities": set(p.capabilities)}) for p in provs]
        for idx, inc in enumerate(incidents):
            chosen, predicted, probs = strat.dispatch(inc, pool, TRAFFIC)
            log = score_dispatch(inc, predicted, chosen, strat.name, idx)
            seed_logs.append(log)
            strat.observe_feedback(inc, inc.true_service_type)
    return seed_logs


def run_config(label: str, M: float, gamma: float, K: float) -> dict:
    t0 = time.time()
    all_seed_logs: list[list[DispatchLog]] = [
        run_one_seed(BASE_SEED + i, M, gamma, K) for i in range(N_SEEDS)
    ]
    elapsed = time.time() - t0

    agg: dict[str, dict[str, float]] = {}
    for name in STRATEGY_NAMES:
        rows = [summarise(sl, name) for sl in all_seed_logs]
        agg[name] = {
            "match_rate_mean":              mean(r.match_rate for r in rows),
            "match_rate_sd":                stdev([r.match_rate for r in rows]),
            "provider_capable_rate_mean":   mean(r.provider_capable_rate for r in rows),
            "provider_capable_rate_sd":     stdev([r.provider_capable_rate for r in rows]),
            "re_dispatch_rate_mean":        mean(r.re_dispatch_rate for r in rows),
            "re_dispatch_rate_sd":          stdev([r.re_dispatch_rate for r in rows]),
            "avg_resolution_time_min_mean": mean(r.avg_resolution_time_min for r in rows),
            "avg_resolution_time_min_sd":   stdev([r.avg_resolution_time_min for r in rows]),
        }

    pooled = {name: [l for sl in all_seed_logs for l in sl if l.strategy == name] for name in STRATEGY_NAMES}

    def compare(a: str, b: str) -> dict:
        res_a = [l.resolution_time_min for l in pooled[a]]
        res_b = [l.resolution_time_min for l in pooled[b]]
        hit_a = [l.matched for l in pooled[a]]
        hit_b = [l.matched for l in pooled[b]]
        cap_a = [l.provider_capable for l in pooled[a]]
        cap_b = [l.provider_capable for l in pooled[b]]
        t_r, p_r = paired_t_test(res_a, res_b)
        mc_hit = mcnemars_test(hit_a, hit_b)
        mc_cap = mcnemars_test(cap_a, cap_b)
        return {
            "resolution_time_t": t_r, "resolution_time_p": p_r,
            "match_mcnemar_p": mc_hit["p_value"], "match_b": mc_hit["b"], "match_c": mc_hit["c"],
            "capable_mcnemar_p": mc_cap["p_value"], "capable_b": mc_cap["b"], "capable_c": mc_cap["c"],
        }

    comparisons = {
        "UADO_vs_ECMOnly": compare("UADO", "ECMOnly"),
        "UADO_vs_ArgmaxECM": compare("UADO", "ArgmaxECM"),
        "ECMOnly_vs_ArgmaxECM": compare("ECMOnly", "ArgmaxECM"),
    }

    # Ordering check on the metric each ablation is meant to move:
    # capable-provider rate for ECM-input-representation quality,
    # match rate for the Bayesian-feedback contribution.
    match = {n: agg[n]["match_rate_mean"] for n in STRATEGY_NAMES}
    capable = {n: agg[n]["provider_capable_rate_mean"] for n in STRATEGY_NAMES}
    ordering_match_uado_gt_ecm = match["UADO"] > match["ECMOnly"]
    ordering_capable_ecm_gt_argmax = capable["ECMOnly"] > capable["ArgmaxECM"] if "ECMOnly" in capable else None
    ordering_capable_uado_gt_argmax = capable["UADO"] > capable["ArgmaxECM"]

    print(f"[{label}] M={M} gamma={gamma} K={K} — done in {elapsed:.1f}s")
    print(f"    match:   UADO={match['UADO']*100:.2f}%  ECMOnly={match['ECMOnly']*100:.2f}%  ArgmaxECM={match['ArgmaxECM']*100:.2f}%")
    print(f"    capable: UADO={capable['UADO']*100:.2f}%  ECMOnly={capable['ECMOnly']*100:.2f}%  ArgmaxECM={capable['ArgmaxECM']*100:.2f}%")
    print(f"    orderings: match(UADO>ECMOnly)={ordering_match_uado_gt_ecm}  "
          f"capable(ECMOnly>ArgmaxECM)={ordering_capable_ecm_gt_argmax}  "
          f"capable(UADO>ArgmaxECM)={ordering_capable_uado_gt_argmax}")

    return {
        "label": label, "M": M, "gamma": gamma, "K": K,
        "aggregate": agg, "comparisons": comparisons,
        "orderings": {
            "match_UADO_gt_ECMOnly": ordering_match_uado_gt_ecm,
            "capable_ECMOnly_gt_ArgmaxECM": ordering_capable_ecm_gt_argmax,
            "capable_UADO_gt_ArgmaxECM": ordering_capable_uado_gt_argmax,
        },
    }


def main() -> int:
    configs = [("baseline", BASELINE["M"], BASELINE["gamma"], BASELINE["K"])]
    for m in GRID["M"]:
        if m != BASELINE["M"]:
            configs.append((f"M={m}", m, BASELINE["gamma"], BASELINE["K"]))
    for g in GRID["gamma"]:
        if g != BASELINE["gamma"]:
            configs.append((f"gamma={g}", BASELINE["M"], g, BASELINE["K"]))
    for k in GRID["K"]:
        if k != BASELINE["K"]:
            configs.append((f"K={k}", BASELINE["M"], BASELINE["gamma"], k))

    print(f"[sensitivity] {len(configs)} configs x {N_SEEDS} seeds x {N_PER_SEED} incidents x {len(STRATEGY_NAMES)} strategies")
    t0 = time.time()
    results = [run_config(label, M, gamma, K) for label, M, gamma, K in configs]
    print(f"[sensitivity] All configs done in {time.time()-t0:.1f}s")

    out_dir = Path(__file__).parent / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "protocol": "sensitivity-1D-sweep",
        "n_per_seed": N_PER_SEED, "n_seeds": N_SEEDS, "n_providers": N_PROVIDERS,
        "baseline": BASELINE, "grid": GRID,
        "configs": results,
    }
    (out_dir / "sensitivity_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[sensitivity] Report written to {out_dir / 'sensitivity_report.json'}")

    all_hold = all(
        r["orderings"]["match_UADO_gt_ECMOnly"] and r["orderings"]["capable_UADO_gt_ArgmaxECM"]
        for r in results
    )
    print(f"\n[sensitivity] Orderings hold at EVERY tested config: {all_hold}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
