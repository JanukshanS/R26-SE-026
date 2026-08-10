"""
============================================================================
Plots — matplotlib figures for the SimPy simulation
============================================================================

Two figures for the thesis Results chapter:

    1. convergence.png  — Bayesian posterior entropy over observation
                          batches for the UADO strategy. Monotonic decrease
                          = quantitative proof that learning is happening.

    2. comparison.png   — Bar chart of match rate / avg resolution time /
                          re-dispatch rate across the 4 strategies.

Both are saved to `sim/outputs/`. matplotlib is a required dep and is
already in `ml/requirements.txt` so no new install needed.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

from pathlib import Path
from statistics import mean

# Non-interactive backend so this works headlessly in CI or over SSH
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .metrics import DispatchLog, StrategySummary


# ─── 1. Bayesian convergence curve ──────────────────────────────────────

def plot_convergence(
    uado_logs:    list[DispatchLog],
    batch_size:   int,
    output_path:  Path,
) -> None:
    """
    Bucket UADO's dispatches into batches of `batch_size` and plot the
    mean posterior entropy per batch. Entropy is only populated for the
    UADO strategy; the plot ignores rows where it's None.
    """
    valid = [l for l in uado_logs if l.posterior_entropy_bits is not None]
    if not valid:
        print("[plots] No entropy samples logged — skipping convergence plot.")
        return

    xs, ys = [], []
    for i in range(0, len(valid), batch_size):
        batch = valid[i:i + batch_size]
        if not batch:
            continue
        xs.append(i + batch_size // 2)
        ys.append(mean(l.posterior_entropy_bits for l in batch))

    plt.figure(figsize=(9, 5))
    plt.plot(xs, ys, marker="o", linewidth=2)
    plt.xlabel("Incidents processed (UADO)")
    plt.ylabel("Mean posterior entropy (bits)")
    plt.title("Bayesian Posterior Concentration — Symptom-Level Entropy Over Time")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"[plots] Saved {output_path}")


# ─── 2. Cross-strategy comparison bars ──────────────────────────────────

def plot_comparison(
    summaries:    list[StrategySummary],
    output_path:  Path,
) -> None:
    """3-panel bar chart across strategies: match rate, avg resolution, re-dispatch rate."""
    if not summaries:
        print("[plots] No summaries — skipping comparison plot.")
        return

    names = [s.strategy for s in summaries]
    match = [s.match_rate for s in summaries]
    time_ = [s.avg_resolution_time_min for s in summaries]
    redis = [s.re_dispatch_rate for s in summaries]

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5))
    for ax, values, title, ylabel in [
        (axes[0], match, "Match Rate (higher is better)",           "P(predicted == actual)"),
        (axes[1], time_, "Avg Resolution Time (lower is better)",   "Minutes"),
        (axes[2], redis, "Re-dispatch Rate (lower is better)",      "Fraction requiring 2nd provider"),
    ]:
        colors = ["#2b8cbe" if n == "UADO" else "#a6bddb" for n in names]
        ax.bar(names, values, color=colors, edgecolor="#1c1c1c")
        ax.set_title(title, fontsize=11)
        ax.set_ylabel(ylabel)
        ax.grid(True, axis="y", alpha=0.3)
        ax.tick_params(axis="x", rotation=20)

    fig.suptitle("Dispatch Strategy Comparison — SimPy 4-Way", fontsize=13, y=1.02)
    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[plots] Saved {output_path}")
