"""
============================================================================
UADO Diagnostic Triage — Train & Compare (Decision Tree vs Random Forest)
============================================================================

Stage 2 of the ML pipeline. Reads the dataset from generate_dataset.py and:

  1. Splits it stratified 80/20 (train/test).
  2. Encodes features (categorical -> one-hot, OBD floats stay numeric).
  3. Trains a DecisionTreeClassifier (PRIMARY — the one we ship to TS).
  4. Trains a RandomForestClassifier (COMPARISON BASELINE).
  5. Reports metrics: top-1 accuracy, top-3 accuracy, macro F1, log-loss.
  6. Saves confusion matrices, the rendered decision tree, a metrics report.
  7. Exports the trained tree as a portable JSON for triage-engine.ts.

The exported tree JSON is *the* artifact that the TypeScript engine will load.
Its shape is documented in the EXPORT FORMAT section at the bottom of this file.

USAGE:
    python train_compare.py
    python train_compare.py --data data/dispatch_train_v1.csv --out reports/

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")  # headless rendering
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

# Force UTF-8 stdout for Windows consoles defaulting to cp1252.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix,
    f1_score, log_loss, top_k_accuracy_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import OneHotEncoder
from sklearn.tree import DecisionTreeClassifier, plot_tree

ROOT = Path(__file__).parent

# ─────────────────────────────────────────────────────────────────────────
# Feature configuration
# ─────────────────────────────────────────────────────────────────────────

# Single-select adaptive questions. Skipped questions arrive as "NOT_ASKED".
CATEGORICAL_SINGLE = [
    "Q1_intent",
    "Q2_engine_start", "Q2b_running_issue",
    "Q3_sound", "Q3b_electrical",
    "Q4_noise_detail", "Q7_overheat_detail", "Q8_smoke_color",
    "Q_brake_detail", "Q_gear_detail",
    "Q6_smells",
    # Sri Lankan context features (always asked)
    "location_type", "recent_rain", "parked_overnight",
    "vehicle_age_bucket", "last_fueled",
]

# Multi-select fields stored as JSON strings; one indicator column per option.
MULTISELECT = {
    "Q5_lights": ["BATTERY", "CHECK_ENGINE", "OIL", "TEMPERATURE",
                  "ABS", "BRAKE", "TIRE_PRESSURE", "SERVICE", "GLOW_PLUG", "NONE"],
    "Q9_recent": ["HARD_START", "LIGHTS_FLICKER", "LOSS_OF_POWER",
                  "OVERHEATING_BEFORE", "UNUSUAL_NOISE", "SMELL_BEFORE", "NO_SIGNS"],
}

OBD_NUMERIC = [
    "battery_voltage_v", "battery_temp_c", "battery_charge_percent",
    "battery_health_percent", "alternator_output_v",
    "engine_temp_c", "coolant_temp_c", "engine_rpm",
    "oil_pressure_psi", "fuel_level_percent", "engine_load_percent",
    "ambient_temp_c",
    "brake_fluid_level_psi", "brake_pad_wear_mm", "brake_temp_c",
]

LABEL_COL = "service_type"


# ─────────────────────────────────────────────────────────────────────────
# Feature pipeline
# ─────────────────────────────────────────────────────────────────────────

def build_features(df: pd.DataFrame, use_obd: bool = True):
    """
    Convert the raw dataset into a feature matrix ready for sklearn.

    Strategy:
      - Categorical single-selects -> one-hot encoded.
      - Multi-selects (JSON arrays) -> indicator column per option.
      - OBD numerics -> kept as-is (skipped when use_obd=False, e.g. Tier-1).

    Returns: (X numpy array, y numpy array, feature_name list, encoders)
    """
    encoders = {}
    feature_blocks = []
    feature_names: list[str] = []

    # ── Single-select categoricals -> one-hot ──
    for col in CATEGORICAL_SINGLE:
        # Empty strings (e.g. engineSound when Q2=YES) become a "MISSING" category
        values = df[col].fillna("MISSING").replace("", "MISSING").to_numpy().reshape(-1, 1)
        enc = OneHotEncoder(sparse_output=False, handle_unknown="ignore")
        block = enc.fit_transform(values)
        encoders[col] = enc
        feature_blocks.append(block)
        feature_names.extend([f"{col}={cat}" for cat in enc.categories_[0]])

    # ── Multi-select -> indicator columns ──
    for col, options in MULTISELECT.items():
        block = np.zeros((len(df), len(options)), dtype=np.float32)
        for i, raw in enumerate(df[col].fillna("[]")):
            try:
                selected = json.loads(raw) if isinstance(raw, str) else list(raw)
            except json.JSONDecodeError:
                selected = []
            for j, opt in enumerate(options):
                if opt in selected:
                    block[i, j] = 1.0
        feature_blocks.append(block)
        feature_names.extend([f"{col}={opt}" for opt in options])

    # ── OBD numerics (Tier-2 only) ──
    if use_obd and all(c in df.columns for c in OBD_NUMERIC):
        obd_block = df[OBD_NUMERIC].astype(float).to_numpy()
        feature_blocks.append(obd_block)
        feature_names.extend(OBD_NUMERIC)

    X = np.hstack(feature_blocks)
    y = df[LABEL_COL].to_numpy()

    return X, y, feature_names, encoders


# ─────────────────────────────────────────────────────────────────────────
# Training & evaluation
# ─────────────────────────────────────────────────────────────────────────

def evaluate(model, X_test, y_test, all_classes) -> dict:
    """Return a dict of evaluation metrics for the given fitted model."""
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    # Re-index proba columns to match all_classes (in case the model didn't
    # see every class during training — possible with our small N)
    proba_full = np.zeros((len(X_test), len(all_classes)))
    for i, cls in enumerate(model.classes_):
        proba_full[:, all_classes.index(cls)] = y_proba[:, i]

    # top-3 accuracy: did the true class appear in the top-3 predictions?
    top3 = top_k_accuracy_score(
        y_test, proba_full, k=3, labels=all_classes,
    )

    return {
        "accuracy":        accuracy_score(y_test, y_pred),
        "top3_accuracy":   top3,
        "macro_f1":        f1_score(y_test, y_pred, average="macro", zero_division=0),
        "weighted_f1":     f1_score(y_test, y_pred, average="weighted", zero_division=0),
        "log_loss":        log_loss(y_test, proba_full, labels=all_classes),
    }


def cv_score(model, X, y, k: int = 5) -> tuple[float, float, int]:
    """
    k-fold stratified CV; returns (mean accuracy, std accuracy, k_used).
    k is auto-reduced to the smallest class size when classes are too thin
    for the requested fold count (common at small N with many classes).
    """
    from collections import Counter
    smallest = min(Counter(y).values())
    k_used = min(k, smallest)
    if k_used < 2:
        return float("nan"), float("nan"), k_used
    skf = StratifiedKFold(n_splits=k_used, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=skf, scoring="accuracy", n_jobs=-1)
    return float(scores.mean()), float(scores.std()), k_used


def plot_confusion(cm, classes, title: str, out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=classes, yticklabels=classes, ax=ax,
                cbar_kws={"label": "count"})
    ax.set_title(title)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    plt.xticks(rotation=45, ha="right")
    plt.yticks(rotation=0)
    plt.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


# ─────────────────────────────────────────────────────────────────────────
# Decision Tree -> portable JSON (for the TypeScript engine to consume)
# ─────────────────────────────────────────────────────────────────────────

def export_tree_to_json(model: DecisionTreeClassifier,
                        feature_names: list[str],
                        class_names: list[str]) -> dict:
    """
    Walk the sklearn tree and emit a dict that the TS engine can traverse.

    Each node is one of:
      - { "type": "leaf",  "probabilities": {service_type: prob, ...}, "samples": n }
      - { "type": "split", "feature": <name>, "threshold": <float>,
          "left": <node>, "right": <node> }

    For one-hot/indicator features the threshold will be 0.5; the TS engine
    will treat that as a boolean check.
    """
    tree = model.tree_

    def recurse(node_id: int) -> dict:
        # Leaf check: sklearn marks leaves with TREE_UNDEFINED feature
        if tree.children_left[node_id] == tree.children_right[node_id]:
            counts = tree.value[node_id][0]
            total = float(counts.sum())
            probs = {
                class_names[i]: float(counts[i] / total) if total > 0 else 0.0
                for i in range(len(class_names))
            }
            return {
                "type":          "leaf",
                "samples":       int(total),
                "probabilities": probs,
            }

        feat_idx = int(tree.feature[node_id])
        return {
            "type":      "split",
            "feature":   feature_names[feat_idx],
            "threshold": float(tree.threshold[node_id]),
            "samples":   int(tree.n_node_samples[node_id]),
            "left":      recurse(int(tree.children_left[node_id])),   # <= threshold
            "right":     recurse(int(tree.children_right[node_id])),  #  > threshold
        }

    return {
        "model_type":    "DecisionTreeClassifier",
        "class_names":   class_names,
        "feature_names": feature_names,
        "max_depth":     int(model.get_depth()),
        "n_leaves":      int(model.get_n_leaves()),
        "root":          recurse(0),
    }


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────

TIER_CONFIG = {
    1: {
        "data_file":     "questionnaire_dataset.csv",
        "description":   "Tier-1 (QUESTIONNAIRE_ONLY) — no OBD signals",
        "use_obd":       False,
        "exported_name": "exported_tree_tier1.json",
        "report_subdir": "tier1",
    },
    2: {
        "data_file":     "tier2_joined.csv",
        "description":   "Tier-2 (OBD_ENHANCED) — questionnaire + OBD telemetry",
        "use_obd":       True,
        "exported_name": "exported_tree_tier2.json",
        "report_subdir": "tier2",
    },
}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--tier", type=int, choices=[1, 2], default=1,
                   help="1=questionnaire-only, 2=questionnaire+OBD enhanced")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    cfg = TIER_CONFIG[args.tier]
    data_path = ROOT / "data" / cfg["data_file"]
    out_dir   = ROOT / "reports" / cfg["report_subdir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 70}")
    print(f"Training {cfg['description']}")
    print(f"{'=' * 70}")

    if not data_path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {data_path}\n"
            "Run `python generate_dataset.py --n 100` first."
        )

    print(f"Loading dataset: {data_path}")
    df = pd.read_csv(data_path)
    print(f"  rows: {len(df)}, columns: {len(df.columns)}")
    print(f"  class balance:\n{df[LABEL_COL].value_counts().sort_index().to_string()}")

    # ── Build features (skip OBD numeric cols for Tier-1) ──
    X, y, feature_names, _ = build_features(df, use_obd=cfg["use_obd"])
    classes = sorted(np.unique(y).tolist())
    print(f"\n  features: {X.shape[1]}  classes: {len(classes)}")

    # ── 80/20 stratified split ──
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=args.seed,
    )
    print(f"  train: {X_train.shape[0]}  test: {X_test.shape[0]}")

    # ── DECISION TREE (primary model) ──
    print("\n── Training Decision Tree (primary) ──")
    dt = DecisionTreeClassifier(
        max_depth=6,
        min_samples_leaf=3,
        criterion="gini",
        random_state=args.seed,
    )
    dt.fit(X_train, y_train)
    dt_metrics = evaluate(dt, X_test, y_test, classes)
    dt_cv_mean, dt_cv_std, dt_cv_k = cv_score(dt, X_train, y_train, k=5)

    print(f"  test accuracy:     {dt_metrics['accuracy']:.3f}")
    print(f"  test top-3 acc:    {dt_metrics['top3_accuracy']:.3f}")
    print(f"  test macro F1:     {dt_metrics['macro_f1']:.3f}")
    print(f"  test log-loss:     {dt_metrics['log_loss']:.3f}")
    print(f"  {dt_cv_k}-fold CV acc:     {dt_cv_mean:.3f} +/- {dt_cv_std:.3f}")
    print(f"  tree depth:        {dt.get_depth()}")
    print(f"  tree leaves:       {dt.get_n_leaves()}")

    # ── RANDOM FOREST (comparison baseline) ──
    print("\n── Training Random Forest (comparison) ──")
    rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=2,
        random_state=args.seed,
        n_jobs=-1,
    )
    rf.fit(X_train, y_train)
    rf_metrics = evaluate(rf, X_test, y_test, classes)
    rf_cv_mean, rf_cv_std, rf_cv_k = cv_score(rf, X_train, y_train, k=5)

    print(f"  test accuracy:     {rf_metrics['accuracy']:.3f}")
    print(f"  test top-3 acc:    {rf_metrics['top3_accuracy']:.3f}")
    print(f"  test macro F1:     {rf_metrics['macro_f1']:.3f}")
    print(f"  test log-loss:     {rf_metrics['log_loss']:.3f}")
    print(f"  {rf_cv_k}-fold CV acc:     {rf_cv_mean:.3f} +/- {rf_cv_std:.3f}")

    # ── Side-by-side comparison ──
    print("\n── Comparison (Decision Tree vs Random Forest) ──")
    print(f"{'Metric':<18}{'Decision Tree':>16}{'Random Forest':>16}{'Delta(DT-RF)':>14}")
    for k in ["accuracy", "top3_accuracy", "macro_f1", "log_loss"]:
        dt_v, rf_v = dt_metrics[k], rf_metrics[k]
        delta = dt_v - rf_v
        print(f"{k:<18}{dt_v:>16.3f}{rf_v:>16.3f}{delta:>+14.3f}")

    # ── Plots: confusion matrices ──
    plot_confusion(
        confusion_matrix(y_test, dt.predict(X_test), labels=classes),
        classes, "Decision Tree — Confusion Matrix",
        out_dir / "confusion_matrix_dt.png",
    )
    plot_confusion(
        confusion_matrix(y_test, rf.predict(X_test), labels=classes),
        classes, "Random Forest — Confusion Matrix",
        out_dir / "confusion_matrix_rf.png",
    )

    # ── Plot the decision tree itself ──
    fig, ax = plt.subplots(figsize=(24, 14))
    plot_tree(
        dt,
        feature_names=feature_names,
        class_names=classes,
        filled=True,
        rounded=True,
        fontsize=8,
        ax=ax,
    )
    fig.savefig(out_dir / "decision_tree.png", dpi=110, bbox_inches="tight")
    plt.close(fig)

    # ── Top feature importances (DT) ──
    importances = sorted(
        zip(feature_names, dt.feature_importances_),
        key=lambda x: -x[1],
    )[:15]
    print("\nTop 15 features by DT importance:")
    for name, imp in importances:
        if imp > 0:
            print(f"  {imp:.3f}  {name}")

    # ── Per-class report (DT) ──
    print("\nDecision Tree — per-class report (test set):")
    print(classification_report(y_test, dt.predict(X_test),
                                labels=classes, zero_division=0))

    # ── Persist artifacts ──
    metrics_doc = {
        "n_train":         int(X_train.shape[0]),
        "n_test":          int(X_test.shape[0]),
        "n_features":      int(X.shape[1]),
        "classes":         classes,
        "decision_tree": {
            "test":         dt_metrics,
            "cv_accuracy":  {"mean": dt_cv_mean, "std": dt_cv_std},
            "depth":        int(dt.get_depth()),
            "leaves":       int(dt.get_n_leaves()),
        },
        "random_forest": {
            "test":         rf_metrics,
            "cv_accuracy":  {"mean": rf_cv_mean, "std": rf_cv_std},
            "n_estimators": 200,
        },
    }
    with open(out_dir / "metrics.json", "w") as f:
        json.dump(metrics_doc, f, indent=2)
    print(f"\n[OK] Wrote {out_dir / 'metrics.json'}")

    # ── Save the fitted models ──
    joblib.dump(dt, out_dir / "decision_tree.pkl")
    joblib.dump(rf, out_dir / "random_forest.pkl")
    print(f"[OK] Saved decision_tree.pkl, random_forest.pkl")

    # ── Export the decision tree as portable JSON ──
    tree_json = export_tree_to_json(dt, feature_names, classes)
    out_tree_json = ROOT / cfg["exported_name"]
    with open(out_tree_json, "w") as f:
        json.dump(tree_json, f, indent=2)
    print(f"[OK] Exported decision tree -> {out_tree_json}")
    print(f"  (this is the artifact triage-engine.ts will consume in Step 4)")


if __name__ == "__main__":
    main()


# ─────────────────────────────────────────────────────────────────────────
# EXPORT FORMAT — exported_tree.json
# ─────────────────────────────────────────────────────────────────────────
#
# {
#   "model_type":    "DecisionTreeClassifier",
#   "class_names":   ["BATTERY_JUMP", "BATTERY_REPLACE", ..., "TOW_HEAVY"],
#   "feature_names": ["visibleDamage=NONE", ..., "battery_voltage_v"],
#   "max_depth":     6,
#   "n_leaves":      14,
#   "root": {
#     "type":      "split",
#     "feature":   "canStartEngine=YES",
#     "threshold": 0.5,
#     "samples":   80,
#     "left": {
#       "type":      "split",
#       "feature":   "engineSound=RAPID_CLICKING",
#       ...
#     },
#     "right": {
#       "type":          "leaf",
#       "samples":       18,
#       "probabilities": {"FLAT_TIRE": 0.72, "LOCKOUT": 0.22, ...}
#     }
#   }
# }
#
# How the TypeScript engine uses it (Step 4 of the roadmap):
#
#   1. Build a feature vector from the request:
#        - For each "feature_names" entry of the form `colname=VALUE`, set
#          1.0 if the request's colname == VALUE, else 0.0.
#        - For numeric features (OBD), pass through the raw value.
#   2. Traverse from the root: at each split, go left if feat <= threshold,
#      else right.
#   3. At the leaf, return the `probabilities` dict — that's the
#      ServiceTypeProbabilities the engine outputs for ECM.
# ─────────────────────────────────────────────────────────────────────────
