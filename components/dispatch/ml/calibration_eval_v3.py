"""
============================================================================
Calibration Evaluation (v3) — Brier score, multiclass log-loss, ECE
============================================================================

Supersedes calibration_eval.py, which evaluated the v1-real trees. The
production trees were retrained by train_v3.py (real-only holdout: train =
real+synthetic, test = 100% real, never synthetic). This script reuses
train_v3.py's exact split + DecisionTree training config so the calibration
numbers describe the SAME model and SAME holdout set as the currently
deployed exported_tree_tier{1,2}.json and the paper's headline accuracy
figures.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.metrics import log_loss

sys.path.insert(0, str(Path(__file__).parent))
from train_v3 import (  # noqa: E402
    load_questionnaire_v3, load_obd_v3, join_for_tier2,
    split_real_only_holdout, train_config,
)

ROOT = Path(__file__).parent
REPORT_DIR = ROOT / "reports"


def compute_calibration(model, X_te, y_te, classes: list[str], n_bins: int = 10) -> dict:
    proba = model.predict_proba(X_te)
    proba_full = np.zeros((len(X_te), len(classes)))
    for i, cls in enumerate(model.classes_):
        proba_full[:, classes.index(cls)] = proba[:, i]

    y_idx = np.array([classes.index(y) for y in y_te])
    y_onehot = np.zeros_like(proba_full)
    y_onehot[np.arange(len(y_te)), y_idx] = 1.0

    brier = float(np.mean(np.sum((proba_full - y_onehot) ** 2, axis=1)))
    ll = float(log_loss(y_te, proba_full, labels=classes))

    confidences = proba_full.max(axis=1)
    preds_idx = proba_full.argmax(axis=1)
    correct = (preds_idx == y_idx).astype(float)

    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    bin_stats = []
    n = len(X_te)
    for i in range(n_bins):
        lo, hi = bins[i], bins[i + 1]
        mask = (confidences >= lo) & (confidences <= hi) if i == n_bins - 1 else (confidences >= lo) & (confidences < hi)
        count = int(mask.sum())
        if count == 0:
            bin_stats.append({"bin": [float(lo), float(hi)], "count": 0, "avg_confidence": None, "accuracy": None})
            continue
        avg_conf = float(confidences[mask].mean())
        acc = float(correct[mask].mean())
        ece += (count / n) * abs(acc - avg_conf)
        bin_stats.append({"bin": [float(lo), float(hi)], "count": count, "avg_confidence": avg_conf, "accuracy": acc})

    return {
        "brier_score_multiclass": brier,
        "log_loss": ll,
        "ece_10bin": float(ece),
        "n_test": int(n),
        "n_classes": len(classes),
        "overall_accuracy": float(correct.mean()),
        "reliability_bins": bin_stats,
    }


def plot_reliability(cal: dict, title: str, out_path: Path) -> None:
    bins = [b for b in cal["reliability_bins"] if b["count"] > 0]
    confs = [b["avg_confidence"] for b in bins]
    accs = [b["accuracy"] for b in bins]
    counts = [b["count"] for b in bins]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    ax1.plot([0, 1], [0, 1], "k--", label="Perfect calibration")
    ax1.plot(confs, accs, "o-", color="#2166ac", label="Model")
    ax1.set_xlabel("Mean predicted confidence (bin)")
    ax1.set_ylabel("Empirical accuracy (bin)")
    ax1.set_title(f"{title}\nECE = {cal['ece_10bin']:.4f}")
    ax1.set_xlim(0, 1); ax1.set_ylim(0, 1)
    ax1.legend()

    edges = [b["bin"][0] for b in bins]
    ax2.bar(edges, counts, width=0.09, align="edge", color="#4393c3", edgecolor="black")
    ax2.set_xlabel("Confidence bin")
    ax2.set_ylabel("Sample count")
    ax2.set_title("Confidence histogram (real-only holdout)")
    ax2.set_xlim(0, 1)

    plt.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> int:
    # min_samples_leaf was hardcoded to 1 here while train_v3.py exposed it as
    # a flag, so this script silently evaluated a DIFFERENT model from the one
    # actually deployed whenever the trees were trained with anything else.
    # The default keeps the historical behaviour; pass the same value used for
    # the deployed trees to measure what is really shipping.
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-samples-leaf", type=int, default=1)
    ap.add_argument("--seed", type=int, default=42)
    # The sanity check below compares against train_v3.py's own reported
    # log-loss, which only matches when both ran with the same settings.
    ap.add_argument("--skip-sanity-check", action="store_true")
    args = ap.parse_args()

    print("=" * 70)
    print(f"Calibration evaluation — v3 real-only-holdout trees "
          f"(min_samples_leaf={args.min_samples_leaf})")
    print("=" * 70)

    seed = args.seed
    q_df = load_questionnaire_v3()
    obd_df = load_obd_v3()

    print("\n--- Tier 1 (questionnaire only, real-only holdout) ---")
    t1_train, t1_test = split_real_only_holdout(q_df, source_col="source", seed=seed)
    m1, f1, c1, met1, (X_te1, y_te1) = train_config(
        t1_train, t1_test, use_obd=False, model_kind="dt", seed=seed, min_samples_leaf=args.min_samples_leaf,
    )
    cal1 = compute_calibration(m1, X_te1, y_te1, c1)
    print(f"Sanity check — log_loss recomputed={cal1['log_loss']:.6f} vs train_v3.py reported={met1['log_loss']:.6f}")
    if not args.skip_sanity_check:
        assert abs(cal1["log_loss"] - met1["log_loss"]) < 1e-6, "Split/model mismatch vs train_v3.py"
    print(json.dumps({k: v for k, v in cal1.items() if k != "reliability_bins"}, indent=2))

    print("\n--- Tier 2 (questionnaire + OBD, real-only holdout) ---")
    joined = join_for_tier2(q_df, obd_df, seed=seed)
    t2_train, t2_test = split_real_only_holdout(joined, source_col="source_joined", seed=seed)
    m2, f2, c2, met2, (X_te2, y_te2) = train_config(
        t2_train, t2_test, use_obd=True, model_kind="dt", seed=seed, min_samples_leaf=args.min_samples_leaf,
    )
    cal2 = compute_calibration(m2, X_te2, y_te2, c2)
    print(f"Sanity check — log_loss recomputed={cal2['log_loss']:.6f} vs train_v3.py reported={met2['log_loss']:.6f}")
    if not args.skip_sanity_check:
        assert abs(cal2["log_loss"] - met2["log_loss"]) < 1e-6, "Split/model mismatch vs train_v3.py"
    print(json.dumps({k: v for k, v in cal2.items() if k != "reliability_bins"}, indent=2))

    plot_reliability(cal1, "Tier 1 v3 — Reliability Diagram", REPORT_DIR / "reliability_v3_tier1.png")
    plot_reliability(cal2, "Tier 2 v3 — Reliability Diagram", REPORT_DIR / "reliability_v3_tier2.png")

    report = {"seed": seed, "model_version": "v3", "tier1": cal1, "tier2": cal2}
    with (REPORT_DIR / "calibration_metrics_v3.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved: {REPORT_DIR / 'calibration_metrics_v3.json'}")
    print(f"Saved: {REPORT_DIR / 'reliability_v3_tier1.png'}, {REPORT_DIR / 'reliability_v3_tier2.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
