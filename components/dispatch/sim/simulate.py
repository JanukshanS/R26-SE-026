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
        paired_t_test, score_dispatch, summarise,
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
    )
else:
    from .bayesian import shannon_entropy
    from .ecm import Provider
    from .metrics import (
        DispatchLog, StrategySummary,
        paired_t_test, score_dispatch, summarise,
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

def main() -> int:
    parser = argparse.ArgumentParser(description="UADO dispatch simulation")
    parser.add_argument("--n",           type=int,   default=1000, help="Number of incidents")
    parser.add_argument("--seed",        type=int,   default=42,   help="RNG seed")
    parser.add_argument("--n-providers", type=int,   default=20,   help="Provider network size")
    parser.add_argument("--traffic",     type=float, default=5.0,  help="Traffic impact score 1-10")
    parser.add_argument("--out",         type=Path,  default=None, help="Output directory (default: sim/outputs/)")
    args = parser.parse_args()

    out_dir = args.out or (Path(__file__).parent / "outputs")

    print(f"[sim] Generating {args.n} incidents (seed={args.seed})")
    incidents = generate_incidents(n=args.n, seed=args.seed)

    print(f"[sim] Seeding {args.n_providers} providers")
    prov_rng = random.Random(args.seed + 1)
    providers = _seed_providers(args.n_providers, prov_rng)

    strategies = [
        UADOStrategy(),
        GreedyNearestStrategy(),
        TypeMatchedNearestStrategy(),
        MultiCriteriaStrategy(),
    ]

    all_logs: list[DispatchLog] = []
    for strat in strategies:
        t0 = time.time()
        # Deep-copy provider state so nobody inherits another strategy's damage
        # (currently providers only carry static config, but this is defensive)
        pool = [Provider(**{**p.__dict__, "capabilities": set(p.capabilities)}) for p in providers]
        logs = _run_strategy(strat, incidents, pool, args.traffic)
        all_logs.extend(logs)
        print(f"[sim] {strat.name:15s} done in {time.time()-t0:.2f}s")

    # ── Aggregate ────────────────────────────────────────────────────
    summaries = [summarise(all_logs, s.name) for s in strategies]

    print("\n" + "─" * 76)
    print(f"{'Strategy':16s} {'N':>5s} {'Match%':>8s} {'Capable%':>10s} {'Redispatch%':>13s} {'AvgRes min':>12s}")
    print("─" * 76)
    for s in summaries:
        print(f"{s.strategy:16s} {s.n_incidents:5d} "
              f"{s.match_rate*100:7.2f}% {s.provider_capable_rate*100:9.2f}% "
              f"{s.re_dispatch_rate*100:12.2f}% {s.avg_resolution_time_min:11.2f}")
    print("─" * 76)

    # ── Paired t-tests: UADO vs each baseline ───────────────────────
    print("\nPaired t-tests (UADO vs baseline):")
    uado_logs = [l for l in all_logs if l.strategy == "UADO"]
    uado_res  = [l.resolution_time_min for l in uado_logs]
    uado_hit  = [1.0 if l.matched else 0.0 for l in uado_logs]

    for s in summaries:
        if s.strategy == "UADO":
            continue
        base_logs = [l for l in all_logs if l.strategy == s.strategy]
        base_res  = [l.resolution_time_min for l in base_logs]
        base_hit  = [1.0 if l.matched else 0.0 for l in base_logs]

        t_r, p_r = paired_t_test(uado_res, base_res)
        t_h, p_h = paired_t_test(uado_hit, base_hit)
        sig_r = "SIGNIFICANT" if p_r < 0.05 else "not sig."
        sig_h = "SIGNIFICANT" if p_h < 0.05 else "not sig."
        print(f"  UADO vs {s.strategy:16s} resolution_time: t={t_r:+.3f} p={p_r:.4f} [{sig_r}]")
        print(f"  UADO vs {s.strategy:16s} match_rate:      t={t_h:+.3f} p={p_h:.4f} [{sig_h}]")

    # ── Persist ──────────────────────────────────────────────────────
    out_dir.mkdir(parents=True, exist_ok=True)
    write_logs_csv(all_logs, out_dir / "dispatch_logs.csv")
    write_summaries_csv(summaries, out_dir / "summaries.csv")
    print(f"\n[sim] CSVs written to {out_dir}")

    # ── Plots ────────────────────────────────────────────────────────
    plot_convergence(uado_logs, batch_size=max(1, args.n // 20), output_path=out_dir / "convergence.png")
    plot_comparison(summaries, output_path=out_dir / "comparison.png")

    print(f"[sim] Done. Total incidents processed: {args.n * len(strategies)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
