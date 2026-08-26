"""
============================================================================
Ablation — Full-Distribution ECM vs Argmax/One-Hot ECM (30-seed protocol)
============================================================================

Isolates ONE design choice: does the ECM cost function integrate over the
full triage probability distribution (production UADO), or does it collapse
to a one-hot on the argmax before costing (the "point-estimate dispatch"
design most published systems use)?

This is DIFFERENT from the existing ECMOnlyStrategy in strategies.py, which
ablates the Bayesian feedback loop (tree+ECM vs tree+Bayesian+ECM). This
script ablates the ECM input distribution itself, holding the Bayesian
blend identical in both arms — both UADO and ArgmaxECM consult and update
the SAME kind of posterior; ArgmaxECM just collapses the blended output to
one-hot before handing it to the same rank_providers() cost function UADO
uses.

Reuses the same 30-seed / paired-t / McNemar protocol as
`sim/simulate.py --n-seeds 30` (see sim/outputs/multi_seed_report.json for
the existing ECMOnly-vs-UADO run) so this ablation is held to the same
statistical rigor as the rest of the paper's results — not a weaker
single-seed comparison.

USAGE
-----
    python -m sim.ablation_ecm --n 1000 --seed 42 --n-seeds 30 --n-providers 20

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
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

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sim.ecm import rank_providers, Provider                          # noqa: E402
    from sim.bayesian import argmax as bayesian_argmax, compute_symptom_key  # noqa: E402
    from sim.scenario import generate_incidents                          # noqa: E402
    from sim.strategies import UADOStrategy                              # noqa: E402
    from sim.tree_walker import get_tree                                 # noqa: E402
    from sim.metrics import (                                            # noqa: E402
        DispatchLog, mcnemars_test, paired_t_test, score_dispatch, summarise,
    )
    from sim.simulate import _seed_providers                             # noqa: E402
else:
    from .ecm import rank_providers, Provider
    from .bayesian import argmax as bayesian_argmax, compute_symptom_key
    from .scenario import generate_incidents
    from .strategies import UADOStrategy
    from .tree_walker import get_tree
    from .metrics import DispatchLog, mcnemars_test, paired_t_test, score_dispatch, summarise
    from .simulate import _seed_providers


class ArgmaxECMStrategy(UADOStrategy):
    """
    Identical to UADOStrategy through the Bayesian blend. Then collapses
    the blended distribution to one_hot(argmax) and feeds THAT to the same
    ECM cost function — the only difference from UADO is what's handed to
    rank_providers().
    """
    name = "ArgmaxECM"

    def dispatch(self, incident, providers, traffic_impact_score: float = 5.0):
        tier = 2 if incident.obd_data and incident.obd_data.get("available") else 1
        tree = get_tree(tier)
        tree_input = dict(incident.responses)
        if tier == 2 and incident.obd_data:
            for k, v in incident.obd_data.items():
                if k != "available":
                    tree_input[k] = v
        tree_probs = tree.predict_proba(tree_input)

        symptom_key = compute_symptom_key(incident.responses)
        blended, _ = self.priors.blend_for(symptom_key, tree_probs)

        argmax_c, _ = bayesian_argmax(blended)
        one_hot = {c: (1.0 if c == argmax_c else 0.0) for c in blended}

        ranked = rank_providers(
            providers, incident.latitude, incident.longitude, one_hot, traffic_impact_score,
            re_dispatch_penalty_minutes=self.re_dispatch_penalty_minutes,
            assessment_delay_minutes=self.assessment_delay_minutes,
        )
        chosen = next(p for p in providers if p.id == ranked[0].provider_id)
        return chosen, argmax_c, one_hot


def _run_one_seed(seed: int, n: int, n_providers: int, traffic: float) -> list[DispatchLog]:
    incidents = generate_incidents(n=n, seed=seed)
    provs = _seed_providers(n_providers, random.Random(seed + 1))
    strategies = [UADOStrategy(), ArgmaxECMStrategy()]

    seed_logs: list[DispatchLog] = []
    for strat in strategies:
        pool = [Provider(**{**p.__dict__, "capabilities": set(p.capabilities)}) for p in provs]
        for idx, inc in enumerate(incidents):
            chosen, predicted, probs = strat.dispatch(inc, pool, traffic)
            log = score_dispatch(inc, predicted, chosen, strat.name, idx)
            seed_logs.append(log)
            strat.observe_feedback(inc, inc.true_service_type)
    return seed_logs


def main() -> int:
    ap = argparse.ArgumentParser(description="Full-distribution ECM vs argmax-collapsed ECM, 30-seed protocol")
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--n-seeds", type=int, default=30)
    ap.add_argument("--n-providers", type=int, default=20)
    ap.add_argument("--traffic", type=float, default=5.0)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    out_dir = args.out or (Path(__file__).parent / "outputs")
    strategy_names = ["UADO", "ArgmaxECM"]

    print(f"[ablation] {args.n_seeds}-seed run: seeds={args.seed}..{args.seed + args.n_seeds - 1}, "
          f"n={args.n}/seed, providers={args.n_providers}")
    t0 = time.time()
    all_seed_logs: list[list[DispatchLog]] = []
    for i in range(args.n_seeds):
        seed = args.seed + i
        all_seed_logs.append(_run_one_seed(seed, args.n, args.n_providers, args.traffic))
    print(f"[ablation] All {args.n_seeds} seeds done in {time.time()-t0:.1f}s")

    per_seed_metrics: dict[str, list[dict[str, float]]] = {n: [] for n in strategy_names}
    for seed_logs in all_seed_logs:
        for name in strategy_names:
            s = summarise(seed_logs, name)
            per_seed_metrics[name].append({
                "match_rate": s.match_rate,
                "provider_capable_rate": s.provider_capable_rate,
                "re_dispatch_rate": s.re_dispatch_rate,
                "avg_resolution_time_min": s.avg_resolution_time_min,
            })

    agg: dict[str, dict[str, float]] = {}
    for name, rows in per_seed_metrics.items():
        agg[name] = {}
        for metric in ["match_rate", "provider_capable_rate", "re_dispatch_rate", "avg_resolution_time_min"]:
            values = [r[metric] for r in rows]
            agg[name][f"{metric}_mean"] = mean(values)
            agg[name][f"{metric}_sd"] = stdev(values) if len(values) > 1 else 0.0

    print("\n" + "─" * 96)
    print(f"{'Strategy':16s} {'Match% (m±SD)':>18s} {'Capable% (m±SD)':>20s} {'Redisp% (m±SD)':>20s} {'AvgRes min (m±SD)':>20s}")
    print("─" * 96)
    for name in strategy_names:
        a = agg[name]
        print(f"{name:16s} "
              f"{a['match_rate_mean']*100:6.2f} ± {a['match_rate_sd']*100:4.2f}    "
              f"{a['provider_capable_rate_mean']*100:6.2f} ± {a['provider_capable_rate_sd']*100:5.2f}     "
              f"{a['re_dispatch_rate_mean']*100:6.2f} ± {a['re_dispatch_rate_sd']*100:5.2f}     "
              f"{a['avg_resolution_time_min_mean']:7.2f} ± {a['avg_resolution_time_min_sd']:5.2f}")
    print("─" * 96)

    pooled = {name: [l for seed_logs in all_seed_logs for l in seed_logs if l.strategy == name]
              for name in strategy_names}
    uado_res = [l.resolution_time_min for l in pooled["UADO"]]
    uado_hit = [l.matched for l in pooled["UADO"]]
    uado_cap = [l.provider_capable for l in pooled["UADO"]]
    argmax_res = [l.resolution_time_min for l in pooled["ArgmaxECM"]]
    argmax_hit = [l.matched for l in pooled["ArgmaxECM"]]
    argmax_cap = [l.provider_capable for l in pooled["ArgmaxECM"]]

    t_r, p_r = paired_t_test(uado_res, argmax_res)
    mc_hit = mcnemars_test(uado_hit, argmax_hit)
    mc_cap = mcnemars_test(uado_cap, argmax_cap)

    print("\nPooled significance across seeds (Full-Distribution ECM vs Argmax-ECM):")
    print(f"  resolution_time: paired-t t={t_r:+.3f} p={p_r:.4f} [{'SIG' if p_r < 0.05 else 'n.s.'}]")
    print(f"  match_rate:      McNemar chi2={mc_hit['chi2']:.3f} (b={int(mc_hit['b'])}, c={int(mc_hit['c'])}) "
          f"p={mc_hit['p_value']:.4f} [{'SIG' if mc_hit['p_value'] < 0.05 else 'n.s.'}]")
    print(f"  capable_rate:    McNemar chi2={mc_cap['chi2']:.3f} (b={int(mc_cap['b'])}, c={int(mc_cap['c'])}) "
          f"p={mc_cap['p_value']:.4f} [{'SIG' if mc_cap['p_value'] < 0.05 else 'n.s.'}]")

    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "protocol": f"{args.n_seeds}-seed",
        "n_per_seed": args.n,
        "n_seeds": args.n_seeds,
        "n_providers": args.n_providers,
        "traffic_impact": args.traffic,
        "strategies": strategy_names,
        "aggregate": agg,
        "significance": {
            "resolution_time_paired_t": float(t_r),
            "resolution_time_p_value": float(p_r),
            "match_rate_mcnemar_chi2": float(mc_hit["chi2"]) if mc_hit["chi2"] == mc_hit["chi2"] else None,
            "match_rate_mcnemar_p_value": float(mc_hit["p_value"]),
            "match_rate_mcnemar_b": float(mc_hit["b"]),
            "match_rate_mcnemar_c": float(mc_hit["c"]),
            "capable_rate_mcnemar_chi2": float(mc_cap["chi2"]) if mc_cap["chi2"] == mc_cap["chi2"] else None,
            "capable_rate_mcnemar_p_value": float(mc_cap["p_value"]),
            "capable_rate_mcnemar_b": float(mc_cap["b"]),
            "capable_rate_mcnemar_c": float(mc_cap["c"]),
        },
    }
    (out_dir / "ablation_ecm_multi_seed_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n[ablation] Report written to {out_dir / 'ablation_ecm_multi_seed_report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
