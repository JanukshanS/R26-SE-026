"""
Phase 3: Refine Impact Scoring Model weights using SUMO ground truth,
and compare formula-based scoring with an ML-based approach.
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

# Build feature matrix from scenario parameters encoded in the SUMO results
from src.impact_scoring import ImpactScoringModel

ROAD_CAPACITY = {
    "motorway": 2200, "trunk": 1800, "primary": 1200,
    "secondary": 800, "tertiary": 600, "residential": 300,
}

model = ImpactScoringModel()

rows = []
for _, r in sumo.iterrows():
    sid = r["scenario_id"]
    # Reconstruct scenario params from the SUMO run
    # We need to re-derive the factors for optimisation
    # Parse from the scenario naming convention
    pass

# Since we have the scored incidents CSV with factor columns already,
# and the SUMO results map to specific factor combinations,
# let's work with the factor columns directly from the merged data.

# Re-derive factors for each SUMO scenario
factor_rows = []
from src.sumo_simulation import SimulationScenario

scenarios = []
sid = 0
for road_type in ["trunk", "primary", "secondary", "tertiary", "residential"]:
    cap = ROAD_CAPACITY[road_type]
    for lanes in [2, 3]:
        for volume_frac in [0.3, 0.6, 0.9]:
            for duration_min in [15, 30, 60]:
                vph = int(cap * volume_frac)
                hour = 8 if volume_frac > 0.8 else 15 if volume_frac > 0.5 else 10
                clf = 1.0 / lanes
                tvf = min(volume_frac, 1.0)
                tf = model.HOUR_VOLUME_MULTIPLIER.get(hour, 0.5) * model.DAY_MULTIPLIER.get(0, 1.0)
                tf = min(tf, 1.0)
                lf = model.ROAD_LOCATION_FACTOR.get(road_type, 0.2)
                isf = model.INCIDENT_SEVERITY.get("engine_failure", 0.7)

                factor_rows.append({
                    "scenario_id": f"S{sid:03d}",
                    "clf": clf, "tvf": tvf, "tf": tf, "lf": lf, "isf": isf,
                    "road_type": road_type, "lanes": lanes,
                    "volume_frac": volume_frac, "duration_min": duration_min,
                })
                sid += 1

factors_df = pd.DataFrame(factor_rows)
merged = sumo.merge(factors_df, on="scenario_id")

target = merged["speed_reduction_pct"].values
if target.max() > 0:
    target_norm = target / target.max()
else:
    target_norm = target

X = merged[["clf", "tvf", "tf", "lf", "isf"]].values

# ── Original weights ──
orig_weights = np.array([0.25, 0.25, 0.20, 0.15, 0.15])
orig_scores = (X @ orig_weights) * 10
orig_scores = np.clip(orig_scores, 1, 10)
r_orig, _ = pearsonr(orig_scores, target)
rho_orig, _ = spearmanr(orig_scores, target)

print(f"{'='*60}")
print(f"  MODEL REFINEMENT RESULTS")
print(f"{'='*60}")
print(f"\n--- Original Weights ---")
print(f"  Weights: CLF={orig_weights[0]}, TVF={orig_weights[1]}, TF={orig_weights[2]}, LF={orig_weights[3]}, ISF={orig_weights[4]}")
print(f"  Pearson r vs speed_reduction: {r_orig:.4f}")
print(f"  Spearman ρ: {rho_orig:.4f}")

# ── Optimise weights ──
def neg_correlation(w):
    w_norm = w / w.sum()
    scores = (X @ w_norm) * 10
    scores = np.clip(scores, 1, 10)
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
print(f"  Spearman ρ: {rho_opt:.4f}")
print(f"  Improvement: {(r_opt - r_orig):.4f} ({(r_opt - r_orig)/abs(r_orig)*100:.1f}%)")

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
print(f"  Random Forest:        r={r_rf:.4f}, CV R²={rf_cv.mean():.4f} ± {rf_cv.std():.4f}")
print(f"  Gradient Boosting:    r={r_gb:.4f}, CV R²={gb_cv.mean():.4f} ± {gb_cv.std():.4f}")
print(f"  Formula (original):   r={r_orig:.4f}")
print(f"  Formula (optimised):  r={r_opt:.4f}")

print(f"\n--- Feature Importance (Random Forest) ---")
importances = rf.feature_importances_
feature_names = ["CLF", "TVF", "TF", "LF", "ISF"]
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
fig.suptitle("Model Refinement — Weight Optimisation & ML Comparison", fontsize=16, fontweight="bold")

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
