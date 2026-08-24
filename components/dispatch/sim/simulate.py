"""
============================================================================
Simulate — main entry point for the UADO dispatch simulation
============================================================================

Runs N incidents through the 4 strategies (UADO + 3 baselines) on the same
incident stream. Produces:

    outputs/dispatch_logs.csv    — one row per (strategy, incident)
    outputs/summaries.csv        — one row per strategy (aggregate)
    outputs/convergence.png      — Bayesian entropy vs incident index
    outputs/comparison.png       — strategy comparison bars

Prints a paired-t-test table (UADO vs each baseline) at the end.

USAGE
-----
    python -m sim.simulate [--n 1000] [--seed 42] [--n-providers 20]

DESIGN NOTES
------------
Every strategy sees the SAME incidents in the SAME order (paired design).
The paired-t-test then measures WHETHER the per-incident performance
differences are statistically significant — a stronger claim than
comparing means across independent samples.

The provider pool is regenerated per strategy (each starts fresh with
default trust=0.75) so no strategy inherits state from another. Bayesian
posterior state is UADO-internal.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

# Force UTF-8 output on Windows (matches the ml/ scripts)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Allow `python sim/simulate.py` in addition to `python -m sim.simulate`
if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sim.bayesian import shannon_entropy               # noqa: E402
    from sim.ecm import Provider                            # noqa: E402
    from sim.metrics import (                                # noqa: E402
        DispatchLog, StrategySummary,
        mcnemars_test, paired_t_test, score_dispatch, summarise,
        write_logs_csv, write_summaries_csv,
    )
    from sim.plots import plot_comparison, plot_convergence  # noqa: E402
    from sim.scenario import (                                # noqa: E402
        ML_SERVICE_TYPES,
        COLOMBO_LAT_MIN, COLOMBO_LAT_MAX,
        COLOMBO_LON_MIN, COLOMBO_LON_MAX,
        generate_incidents,
    )
    from sim.strategies import (                              # noqa: E402
        UADOStrategy, GreedyNearestStrategy,
        TypeMatchedNearestStrategy, MultiCriteriaStrategy,
        ECMOnlyStrategy,
    )
else:
    from .bayesian import shannon_entropy
    from .ecm import Provider
    from .metrics import (
        DispatchLog, StrategySummary,
        mcnemars_test, paired_t_test, score_dispatch, summarise,
        write_logs_csv, write_summaries_csv,
    )
    from .plots import plot_comparison, plot_convergence
    from .scenario import (
        ML_SERVICE_TYPES,
        COLOMBO_LAT_MIN, COLOMBO_LAT_MAX,
        COLOMBO_LON_MIN, COLOMBO_LON_MAX,
        generate_incidents,
    )
    from .strategies import (
        UADOStrategy, GreedyNearestStrategy,
        TypeMatchedNearestStrategy, MultiCriteriaStrategy,
        ECMOnlyStrategy,
    )


# ─────────────────────────────────────────────────────────────────────────
# Provider seeding — matches the shape of prisma/seed.ts's distribution
# ─────────────────────────────────────────────────────────────────────────

_CAP_MOBILE_MECH  = {
    "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE", "ALTERNATOR_ISSUE",
    "STARTER_MOTOR", "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK",
    "BELT_BROKEN", "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN", "BRAKE_PAD_WORN", "FLAT_TIRE_CHANGE",
    "LIGHT_BULB", "BLOWN_FUSE",
}
_CAP_TOW_LIGHT   = _CAP_MOBILE_MECH | {"BRAKE_FAILURE", "CLUTCH_WORN", "TRANSMISSION_ISSUE", "ENGINE_OVERHEAT_SEVERE"}
_CAP_TOW_HEAVY   = _CAP_TOW_LIGHT | {"SEVERE_MECHANICAL_TOW", "MAJOR_ACCIDENT", "URGENT_TOW", "FLOOD_RECOVERY"}
_CAP_FUEL        = {"FUEL_EMPTY", "FUEL_WRONG"}
_CAP_LOCKSMITH   = {"LOCKOUT", "KEY_LOST"}


def _seed_providers(n: int, rng: random.Random) -> list[Provider]:
    """Realistic mix mirroring seed.ts: ~40% mechanics, 25% light tow, ..."""
    providers: list[Provider] = []
    for i in range(n):
        pick = rng.random()
        if   pick < 0.40: cap, ptype = _CAP_MOBILE_MECH, "MOBILE_MECHANIC"
        elif pick < 0.65: cap, ptype = _CAP_TOW_LIGHT,   "TOW_LIGHT"
        elif pick < 0.80: cap, ptype = _CAP_TOW_HEAVY,   "TOW_HEAVY"
        elif pick < 0.92: cap, ptype = _CAP_FUEL,        "FUEL_DELIVERY"
        else:             cap, ptype = _CAP_LOCKSMITH,   "LOCKSMITH"

        providers.append(Provider(
            id           = f"prov_{i:03d}_{ptype}",
            name         = f"{ptype}-{i}",
            latitude     = rng.uniform(COLOMBO_LAT_MIN, COLOMBO_LAT_MAX),
            longitude    = rng.uniform(COLOMBO_LON_MIN, COLOMBO_LON_MAX),
            capabilities = set(cap),
            trust_score  = round(rng.uniform(0.70, 0.90), 2),
            available    = True,
        ))
    return providers


# ─────────────────────────────────────────────────────────────────────────
# Simulation loop for one strategy
# ─────────────────────────────────────────────────────────────────────────

def _run_strategy(
    strategy,
    incidents,
    providers,
    traffic_impact_score: float,
) -> list[DispatchLog]:
    logs: list[DispatchLog] = []
    for idx, inc in enumerate(incidents):
        chosen, predicted, probs = strategy.dispatch(inc, providers, traffic_impact_score)
        entropy = shannon_entropy(probs) if strategy.name == "UADO" else None

        log = score_dispatch(
            incident               = inc,
            predicted_service_type = predicted,
            chosen_provider        = chosen,
            strategy_name          = strategy.name,
            incident_index         = idx,
            posterior_entropy_bits = entropy,
        )
        logs.append(log)

        # Feed ground truth back — only UADO acts on it (baselines no-op)
        strategy.observe_feedback(inc, inc.true_service_type)
    return logs


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────

def _build_strategies() -> list:
    """Fresh strategy instances (UADO state resets per seed)."""
    return [
        UADOStrategy(),
        ECMOnlyStrategy(),
        GreedyNearestStrategy(),
        TypeMatchedNearestStrategy(),
        MultiCriteriaStrategy(),
    ]


def _run_one_seed(
    seed:         int,
    n:            int,
    n_providers:  int,
    traffic:      float,
) -> list[DispatchLog]:
    """
    Generate incidents + providers for one seed and run every strategy on
    identical inputs. Returns the concatenated per-incident dispatch logs.
    Each strategy's UADO/priors state is fresh (created here).
    """
    incidents = generate_incidents(n=n, seed=seed)
    provs     = _seed_providers(n_providers, random.Random(seed + 1))
    strategies = _build_strategies()

    seed_logs: list[DispatchLog] = []
    for strat in strategies:
        # Deep-copy provider state per strategy (defensive; providers are
        # currently static but future changes might mutate).
        pool = [Provider(**{**p.__dict__, "capabilities": set(p.capabilities)}) for p in provs]
        seed_logs.extend(_run_strategy(strat, incidents, pool, traffic))
    return seed_logs


def _print_single_seed_report(
    logs:      list[DispatchLog],
    strategy_names: list[str],
) -> list[StrategySummary]:
    """Compact single-seed report: table + paired t-tests + McNemar's."""
    summaries = [summarise(logs, name) for name in strategy_names]

    print("\n" + "─" * 76)
    print(f"{'Strategy':16s} {'N':>5s} {'Match%':>8s} {'Capable%':>10s} {'Redispatch%':>13s} {'AvgRes min':>12s}")
    print("─" * 76)
    for s in summaries:
        print(f"{s.strategy:16s} {s.n_incidents:5d} "
              f"{s.match_rate*100:7.2f}% {s.provider_capable_rate*100:9.2f}% "
              f"{s.re_dispatch_rate*100:12.2f}% {s.avg_resolution_time_min:11.2f}")
    print("─" * 76)

    # Paired t-test on resolution time (continuous), McNemar's on match
    # rate (binary). Both keyed to UADO as the reference.
    uado_logs = [l for l in logs if l.strategy == "UADO"]
    uado_res  = [l.resolution_time_min for l in uado_logs]
    uado_hit  = [l.matched for l in uado_logs]

    print("\nSignificance tests (UADO vs baseline):")
    for name in strategy_names:
        if name == "UADO":
            continue
        base_logs = [l for l in logs if l.strategy == name]
        base_res  = [l.resolution_time_min for l in base_logs]
        base_hit  = [l.matched for l in base_logs]
        t_r, p_r = paired_t_test(uado_res, base_res)
        mc       = mcnemars_test(uado_hit, base_hit)
        sig_r = "SIG" if p_r < 0.05 else "n.s."
        sig_m = "SIG" if mc["p_value"] < 0.05 else "n.s."
        print(f"  UADO vs {name:16s} resolution_time: paired-t t={t_r:+.3f} p={p_r:.4f} [{sig_r}]")
        print(f"  UADO vs {name:16s} match_rate:      McNemar χ²={mc['chi2']:.3f} "
              f"(b={int(mc['b'])}, c={int(mc['c'])}) p={mc['p_value']:.4f} [{sig_m}]")
    return summaries


def _print_multi_seed_report(
    all_seed_logs:   list[list[DispatchLog]],
    strategy_names:  list[str],
) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    """
    Multi-seed report: per-strategy metrics as mean ± SD across seeds,
    plus McNemar's + paired-t on the POOLED per-incident sequences
    (concatenated across seeds — 30 × N pairs per baseline).
    """
    # ── Per-seed metrics, then aggregate across seeds ────────────────
    per_seed_metrics: dict[str, list[dict[str, float]]] = {n: [] for n in strategy_names}
    for seed_logs in all_seed_logs:
        for name in strategy_names:
            s = summarise(seed_logs, name)
            per_seed_metrics[name].append({
                "match_rate":              s.match_rate,
                "provider_capable_rate":   s.provider_capable_rate,
                "re_dispatch_rate":        s.re_dispatch_rate,
                "avg_resolution_time_min": s.avg_resolution_time_min,
            })

    from statistics import mean, stdev
    agg: dict[str, dict[str, float]] = {}
    for name, rows in per_seed_metrics.items():
        agg[name] = {}
        for metric in ["match_rate", "provider_capable_rate", "re_dispatch_rate", "avg_resolution_time_min"]:
            values = [r[metric] for r in rows]
            agg[name][f"{metric}_mean"] = mean(values)
            agg[name][f"{metric}_sd"]   = stdev(values) if len(values) > 1 else 0.0

    print("\n" + "─" * 96)
    print(f"{'Strategy':16s} {'Match% (mean±SD)':>20s} {'Capable% (m±SD)':>20s} {'Redisp% (m±SD)':>20s} {'AvgRes min (m±SD)':>20s}")
    print("─" * 96)
    for name in strategy_names:
        a = agg[name]
        print(f"{name:16s} "
              f"{a['match_rate_mean']*100:7.2f} ± {a['match_rate_sd']*100:5.2f}     "
              f"{a['provider_capable_rate_mean']*100:6.2f} ± {a['provider_capable_rate_sd']*100:5.2f}     "
              f"{a['re_dispatch_rate_mean']*100:6.2f} ± {a['re_dispatch_rate_sd']*100:5.2f}     "
              f"{a['avg_resolution_time_min_mean']:7.2f} ± {a['avg_resolution_time_min_sd']:5.2f}")
    print("─" * 96)

    # ── Pooled significance across all seeds ─────────────────────────
    tests: dict[str, dict[str, float]] = {}
    pooled = {name: [l for seed_logs in all_seed_logs for l in seed_logs if l.strategy == name]
              for name in strategy_names}
    uado_res = [l.resolution_time_min for l in pooled["UADO"]]
    uado_hit = [l.matched              for l in pooled["UADO"]]

    print("\nPooled significance across seeds (UADO vs each other strategy):")
    for name in strategy_names:
        if name == "UADO":
            continue
        base_res = [l.resolution_time_min for l in pooled[name]]
        base_hit = [l.matched              for l in pooled[name]]
        t_r, p_r = paired_t_test(uado_res, base_res)
        mc       = mcnemars_test(uado_hit, base_hit)
        tests[name] = {
            "paired_t":            float(t_r),
            "paired_t_p_value":    float(p_r),
            "mcnemar_chi2":        float(mc["chi2"]),
            "mcnemar_p_value":     float(mc["p_value"]),
            "mcnemar_b":           float(mc["b"]),
            "mcnemar_c":           float(mc["c"]),
        }
        sig_r = "SIG" if p_r < 0.05 else "n.s."
        sig_m = "SIG" if mc["p_value"] < 0.05 else "n.s."
        print(f"  UADO vs {name:16s} resolution_time: paired-t t={t_r:+7.3f} p={p_r:.4f} [{sig_r}]")
        print(f"  UADO vs {name:16s} match_rate:      McNemar χ²={mc['chi2']:8.2f} "
              f"(b={int(mc['b'])}, c={int(mc['c'])}) p={mc['p_value']:.4f} [{sig_m}]")

    return agg, tests


def main() -> int:
    parser = argparse.ArgumentParser(description="UADO dispatch simulation")
    parser.add_argument("--n",           type=int,   default=1000, help="Number of incidents per seed")
    parser.add_argument("--seed",        type=int,   default=42,   help="RNG seed (or starting seed for multi-seed)")
    parser.add_argument("--n-seeds",     type=int,   default=1,    help="Number of seeds — 1 for single-run, 30+ for statistical protocol")
    parser.add_argument("--n-providers", type=int,   default=20,   help="Provider network size")
    parser.add_argument("--traffic",     type=float, default=5.0,  help="Traffic impact score 1-10")
    parser.add_argument("--out",         type=Path,  default=None, help="Output directory (default: sim/outputs/)")
    args = parser.parse_args()

    out_dir = args.out or (Path(__file__).parent / "outputs")
    strategy_names = [s.name for s in _build_strategies()]

    # ── Single-seed (backward-compat, full per-incident logs + plots) ─
    if args.n_seeds == 1:
        print(f"[sim] Single-seed run: seed={args.seed}, n={args.n}, providers={args.n_providers}")
        t0 = time.time()
        seed_logs = _run_one_seed(args.seed, args.n, args.n_providers, args.traffic)
        print(f"[sim] All strategies done in {time.time()-t0:.2f}s")

        summaries = _print_single_seed_report(seed_logs, strategy_names)

        out_dir.mkdir(parents=True, exist_ok=True)
        write_logs_csv(seed_logs, out_dir / "dispatch_logs.csv")
        write_summaries_csv(summaries, out_dir / "summaries.csv")
        uado_logs = [l for l in seed_logs if l.strategy == "UADO"]
        plot_convergence(uado_logs, batch_size=max(1, args.n // 20), output_path=out_dir / "convergence.png")
        plot_comparison(summaries, output_path=out_dir / "comparison.png")
        print(f"\n[sim] Outputs written to {out_dir}")
        print(f"[sim] Total dispatches: {args.n * len(strategy_names)}")
        return 0

    # ── Multi-seed protocol (30-seed statistical run) ────────────────
    print(f"[sim] Multi-seed run: seeds={args.seed}..{args.seed + args.n_seeds - 1}, "
          f"n={args.n}/seed, providers={args.n_providers}")
    t0 = time.time()
    all_seed_logs: list[list[DispatchLog]] = []
    for i in range(args.n_seeds):
        seed = args.seed + i
        seed_t0 = time.time()
        seed_logs = _run_one_seed(seed, args.n, args.n_providers, args.traffic)
        all_seed_logs.append(seed_logs)
        if (i + 1) % 5 == 0 or i == args.n_seeds - 1:
            print(f"[sim]   seed {seed} done ({i+1}/{args.n_seeds}) — {time.time()-seed_t0:.2f}s")
    print(f"[sim] All {args.n_seeds} seeds done in {time.time()-t0:.1f}s")

    agg, tests = _print_multi_seed_report(all_seed_logs, strategy_names)

    # ── Persist ──────────────────────────────────────────────────────
    out_dir.mkdir(parents=True, exist_ok=True)
    import json as _json
    report = {
        "protocol":       "30-seed" if args.n_seeds == 30 else f"{args.n_seeds}-seed",
        "n_per_seed":     args.n,
        "n_seeds":        args.n_seeds,
        "n_providers":    args.n_providers,
        "traffic_impact": args.traffic,
        "strategies":     strategy_names,
        "aggregate":      agg,
        "significance":   tests,
    }
    (out_dir / "multi_seed_report.json").write_text(_json.dumps(report, indent=2), encoding="utf-8")

    # Also write a compact per-strategy CSV of mean ± SD.
    import csv as _csv
    with (out_dir / "multi_seed_summaries.csv").open("w", newline="", encoding="utf-8") as f:
        w = _csv.writer(f)
        w.writerow(["strategy", "match_mean", "match_sd", "capable_mean", "capable_sd",
                    "redisp_mean", "redisp_sd", "avg_res_min_mean", "avg_res_min_sd"])
        for name in strategy_names:
            a = agg[name]
            w.writerow([name,
                        round(a['match_rate_mean'], 6),              round(a['match_rate_sd'], 6),
                        round(a['provider_capable_rate_mean'], 6),   round(a['provider_capable_rate_sd'], 6),
                        round(a['re_dispatch_rate_mean'], 6),        round(a['re_dispatch_rate_sd'], 6),
                        round(a['avg_resolution_time_min_mean'], 4), round(a['avg_resolution_time_min_sd'], 4)])
    print(f"\n[sim] Multi-seed report + summaries written to {out_dir}")
    print(f"[sim] Total dispatches: {args.n * len(strategy_names) * args.n_seeds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
