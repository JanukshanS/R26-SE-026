"""
Phase 3: Refine Impact Scoring Model weights using SUMO ground truth,
and compare formula-based scoring with an ML-based approach.

The 5-factor matrix (CLF, TVF, TF, LF, ISF) is read DIRECTLY from the factor
columns now stored in data/sumo_results.csv. The previous version reconstructed
the factors from scenario parameters on a DEGENERATE grid where ISF was constant
(every scenario was engine_failure), lanes_blocked was always 1, and hour was set
deterministically FROM volume_frac -- so 3 of the 5 factors did not actually vary
and only CLF/LF were data-identified. The new SUMO grid varies all five factors
independently, so reading the stored columns is both simpler and the only way to
let the refit see the now-decoupled signal. Target stays speed_reduction_pct.

Author: Asath M M (IT22633422)
Component: Geo-Intelligence & Traffic Impact Analysis
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import minimize
from scipy.stats import pearsonr, spearmanr
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "analysis")

sumo = pd.read_csv(os.path.join(DATA_DIR, "sumo_results.csv"))

# ── Factor matrix: read the model factor columns directly from the SUMO run ──
# data/sumo_results.csv now carries clf, tvf, tf, lf, isf per scenario (written by
# scripts/run_sumo_validation.py on the non-degenerate grid). No reconstruction.
FACTOR_COLS = ["clf", "tvf", "tf", "lf", "isf"]
feature_names = ["CLF", "TVF", "TF", "LF", "ISF"]

merged = sumo
target = merged["speed_reduction_pct"].values.astype(float)
X = merged[FACTOR_COLS].values.astype(float)

# ── Original weights ──
orig_weights = np.array([0.25, 0.25, 0.20, 0.15, 0.15])
orig_scores = (X @ orig_weights) * 10
orig_scores = np.clip(orig_scores, 1, 10)
r_orig, _ = pearsonr(orig_scores, target)
rho_orig, _ = spearmanr(orig_scores, target)

print(f"{'='*60}")
print(f"  MODEL REFINEMENT RESULTS")
print(f"{'='*60}")
print(f"\n  Scenarios (rows in sumo_results.csv): {len(merged)}")
print(f"  Factor source: clf/tvf/tf/lf/isf columns read directly from CSV")
print(f"\n--- Original Weights ---")
print(f"  Weights: CLF={orig_weights[0]}, TVF={orig_weights[1]}, TF={orig_weights[2]}, LF={orig_weights[3]}, ISF={orig_weights[4]}")
print(f"  Pearson r vs speed_reduction: {r_orig:.4f}")
print(f"  Spearman rho: {rho_orig:.4f}")

# ── Optimise weights ──
def neg_correlation(w):
    w_norm = w / w.sum()
    scores = (X @ w_norm) * 10
    scores = np.clip(scores, 1, 10)
    if np.std(scores) == 0:
        return 0.0
    r, _ = pearsonr(scores, target)
    return -r

bounds = [(0.05, 0.50)] * 5
constraints = {"type": "eq", "fun": lambda w: w.sum() - 1.0}
result = minimize(neg_correlation, orig_weights, method="SLSQP",
                  bounds=bounds, constraints=constraints)

opt_weights = result.x / result.x.sum()
opt_scores = (X @ opt_weights) * 10
opt_scores = np.clip(opt_scores, 1, 10)
r_opt, _ = pearsonr(opt_scores, target)
rho_opt, _ = spearmanr(opt_scores, target)

print(f"\n--- Optimised Weights ---")
print(f"  Weights: CLF={opt_weights[0]:.3f}, TVF={opt_weights[1]:.3f}, TF={opt_weights[2]:.3f}, LF={opt_weights[3]:.3f}, ISF={opt_weights[4]:.3f}")
print(f"  Pearson r vs speed_reduction: {r_opt:.4f}")
print(f"  Spearman rho: {rho_opt:.4f}")
print(f"  Improvement: {(r_opt - r_orig):.4f} ({(r_opt - r_orig)/abs(r_orig)*100:.1f}%)")

# ── Per-factor identifiability (distinct values + raw correlation w/ target) ──
print(f"\n--- Per-Factor Identifiability (vs speed_reduction_pct) ---")
print(f"  {'factor':<6} {'n_distinct':>10} {'pearson_r':>10} {'spearman':>10}")
ident = {}
for name, col in zip(feature_names, FACTOR_COLS):
    vals = merged[col].values.astype(float)
    nd = int(merged[col].nunique())
    if np.std(vals) == 0:
        rr, ss = float("nan"), float("nan")
    else:
        rr, _ = pearsonr(vals, target)
        ss, _ = spearmanr(vals, target)
    ident[name] = {"n_distinct": nd, "pearson_r": rr, "spearman": ss}
    print(f"  {name:<6} {nd:>10} {rr:>10.4f} {ss:>10.4f}")

# ── ML Comparison: Random Forest ──
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

rf = RandomForestRegressor(n_estimators=100, random_state=42, max_depth=5)
rf_cv = cross_val_score(rf, X_scaled, target, cv=5, scoring="r2")
rf.fit(X_scaled, target)
rf_pred = rf.predict(X_scaled)
r_rf, _ = pearsonr(rf_pred, target)

gb = GradientBoostingRegressor(n_estimators=100, random_state=42, max_depth=3)
gb_cv = cross_val_score(gb, X_scaled, target, cv=5, scoring="r2")
gb.fit(X_scaled, target)
gb_pred = gb.predict(X_scaled)
r_gb, _ = pearsonr(gb_pred, target)

print(f"\n--- ML Model Comparison ---")
print(f"  Random Forest:        r={r_rf:.4f}, CV R2={rf_cv.mean():.4f} +/- {rf_cv.std():.4f}")
print(f"  Gradient Boosting:    r={r_gb:.4f}, CV R2={gb_cv.mean():.4f} +/- {gb_cv.std():.4f}")
print(f"  Formula (original):   r={r_orig:.4f}")
print(f"  Formula (optimised):  r={r_opt:.4f}")

print(f"\n--- Feature Importance (Random Forest) ---")
importances = rf.feature_importances_
for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
    print(f"  {name}: {imp:.4f}")

# ── Save refined weights ──
refined = {
    "original_weights": dict(zip(feature_names, orig_weights)),
    "optimised_weights": dict(zip(feature_names, opt_weights)),
    "original_r": r_orig,
    "optimised_r": r_opt,
    "rf_r": r_rf,
    "gb_r": r_gb,
}
pd.DataFrame([refined]).to_csv(os.path.join(DATA_DIR, "refined_weights.csv"), index=False)

# ── Charts ──
fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle("Model Refinement -- Weight Optimisation & ML Comparison", fontsize=16, fontweight="bold")

axes[0, 0].scatter(orig_scores, target, s=30, alpha=0.6, c="#377eb8", label=f"Original (r={r_orig:.3f})")
axes[0, 0].scatter(opt_scores, target, s=30, alpha=0.6, c="#e41a1c", label=f"Optimised (r={r_opt:.3f})")
axes[0, 0].set_xlabel("Impact Score (Formula)")
axes[0, 0].set_ylabel("Speed Reduction % (SUMO)")
axes[0, 0].set_title("Formula Scoring: Before vs After Optimisation")
axes[0, 0].legend()

x_pos = np.arange(len(feature_names))
width = 0.35
axes[0, 1].bar(x_pos - width/2, orig_weights, width, label="Original", color="#377eb8")
axes[0, 1].bar(x_pos + width/2, opt_weights, width, label="Optimised", color="#e41a1c")
axes[0, 1].set_xticks(x_pos)
axes[0, 1].set_xticklabels(feature_names)
axes[0, 1].set_ylabel("Weight")
axes[0, 1].set_title("Weight Comparison")
axes[0, 1].legend()

models = ["Formula\n(original)", "Formula\n(optimised)", "Random\nForest", "Gradient\nBoosting"]
r_values = [r_orig, r_opt, r_rf, r_gb]
colors = ["#377eb8", "#e41a1c", "#4daf4a", "#984ea3"]
axes[1, 0].bar(models, r_values, color=colors)
axes[1, 0].set_ylabel("Pearson r")
axes[1, 0].set_title("Model Comparison (Correlation with SUMO)")
axes[1, 0].set_ylim(0, 1)
for i, v in enumerate(r_values):
    axes[1, 0].text(i, v + 0.02, f"{v:.3f}", ha="center", fontsize=10)

imp_sorted = sorted(zip(feature_names, importances), key=lambda x: x[1])
axes[1, 1].barh([x[0] for x in imp_sorted], [x[1] for x in imp_sorted], color="#4daf4a")
axes[1, 1].set_xlabel("Feature Importance")
axes[1, 1].set_title("Random Forest Feature Importance")

plt.tight_layout()
chart_path = os.path.join(OUTPUT_DIR, "model_comparison.png")
plt.savefig(chart_path, dpi=150, bbox_inches="tight")
plt.close()
print(f"\nSaved comparison chart to: {chart_path}")

print(f"\n{'='*60}")
print(f"  MODEL REFINEMENT COMPLETE")
print(f"{'='*60}")
