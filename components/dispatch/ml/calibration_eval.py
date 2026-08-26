"""
============================================================================
Calibration Evaluation — Brier score, multiclass log-loss, ECE/reliability
============================================================================

Reuses train_real.py's exact data loading + train/test split (same seed=42,
same 80/20 stratified split) so these numbers describe the SAME holdout set
and SAME trees as the headline accuracy figures already reported for the
paper (ml/reports/real_data_metrics.json). Does not retrain anything new —
just adds calibration diagnostics on top of the existing deterministic split.

METRICS
-------
  Brier score (multiclass) = mean_i [ sum_k (P_ik - y_ik)^2 ]
      where P_ik is the predicted probability of class k for sample i,
      and y_ik is the one-hot ground truth. Standard multiclass
      generalization of the binary Brier score (lower = better, 0 = perfect).

  Log-loss = sklearn.metrics.log_loss(y_true, P, labels=all_classes)
      Cross-checked against train_real.py's own reported log_loss for the
      same tier as a correctness sanity check (should match exactly).

  ECE (Expected Calibration Error, 10 equal-width bins on confidence
  = max predicted probability):
      ECE = sum_b (n_b / N) * |accuracy_b - avg_confidence_b|

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

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
from train_real import load_questionnaire, load_obd, join_for_tier2, train_one_tier  # noqa: E402

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

    edges = [b["bin"][0] for b in cal["reliability_bins"]]
    ax2.bar(edges, counts, width=0.09, align="edge", color="#4393c3", edgecolor="black")
    ax2.set_xlabel("Confidence bin")
    ax2.set_ylabel("Sample count")
    ax2.set_title("Confidence histogram (holdout set)")
    ax2.set_xlim(0, 1)

    plt.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> int:
    print("=" * 70)
    print("Calibration evaluation — real-data trees, same split as train_real.py")
    print("=" * 70)

    q_df = load_questionnaire()
    obd_df = load_obd()

    print("\n--- Tier 1 (questionnaire only) ---")
    m1, f1, c1, met1, (X_te1, y_te1) = train_one_tier(q_df, use_obd=False, seed=42, min_samples_leaf=1)
    cal1 = compute_calibration(m1, X_te1, y_te1, c1)
    print(f"Sanity check — log_loss recomputed={cal1['log_loss']:.6f} vs train_real.py reported={met1['log_loss']:.6f}")
    assert abs(cal1["log_loss"] - met1["log_loss"]) < 1e-6, "Split/model mismatch — recomputed log_loss disagrees with train_real.py"
    print(json.dumps({k: v for k, v in cal1.items() if k != "reliability_bins"}, indent=2))

    print("\n--- Tier 2 (questionnaire + OBD) ---")
    joined = join_for_tier2(q_df, obd_df, seed=42)
    m2, f2, c2, met2, (X_te2, y_te2) = train_one_tier(joined, use_obd=True, seed=42, min_samples_leaf=1)
    cal2 = compute_calibration(m2, X_te2, y_te2, c2)
    print(f"Sanity check — log_loss recomputed={cal2['log_loss']:.6f} vs train_real.py reported={met2['log_loss']:.6f}")
    assert abs(cal2["log_loss"] - met2["log_loss"]) < 1e-6, "Split/model mismatch — recomputed log_loss disagrees with train_real.py"
    print(json.dumps({k: v for k, v in cal2.items() if k != "reliability_bins"}, indent=2))

    plot_reliability(cal1, "Tier 1 — Reliability Diagram", REPORT_DIR / "reliability_tier1.png")
    plot_reliability(cal2, "Tier 2 — Reliability Diagram", REPORT_DIR / "reliability_tier2.png")

    report = {"seed": 42, "tier1": cal1, "tier2": cal2}
    with (REPORT_DIR / "calibration_metrics.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved: {REPORT_DIR / 'calibration_metrics.json'}")
    print(f"Saved: {REPORT_DIR / 'reliability_tier1.png'}, {REPORT_DIR / 'reliability_tier2.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
