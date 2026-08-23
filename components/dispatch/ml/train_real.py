"""
============================================================================
UADO Diagnostic Triage — Train on REAL DATA (validated questionnaire + OBD)
============================================================================

Second-stage training pipeline. Replaces the synthetic-data trees in
`exported_tree_tier{1,2}.json` with trees trained on:

  * `new_datasets/questionnaire_dataset_validated.xlsx` (443 rows) — real
    Q&A responses validated against automotive_faults.json + fault_flowchart.json
    and expert mechanics. Fields match our runtime schema exactly.

  * `new_datasets/obd_dataset.csv` (285 rows) — real OBD sensor readings
    with our exact column schema and 15 examples per service type.

The two sources cover DIFFERENT incidents (one is driver Q&A, the other is
sensor telemetry), so for Tier 2 (OBD-enhanced) we join them per row by
service_type — each questionnaire row is paired with a randomly-sampled
OBD row that shares its service_type. This is the standard treatment when
you have complementary datasets on related phenomena; it preserves the
signal in each half without inventing synthetic pairings.

CLASS FILTERING
---------------
The questionnaire dataset contains two service types not (yet) modelled by
our runtime: HYDRO_LOCK and ABS_SENSOR_RUST_CORROSION. We drop those rows
(9 total, 2.0% of the dataset) rather than attempting silent remapping.
Adding them to the runtime catalog is scoped as future work.

OUTPUTS
-------
    ml/exported_tree_tier1.json     — replaces synthetic Tier 1 tree
    ml/exported_tree_tier2.json     — replaces synthetic Tier 2 tree
    ml/exported_tree_tier1_synthetic.json  — synthetic backup (renamed once)
    ml/exported_tree_tier2_synthetic.json  — synthetic backup (renamed once)
    ml/reports/real_data_metrics.json      — accuracy report for the paper
    ml/reports/real_confusion_tier{1,2}.png — confusion matrices

USAGE
-----
    python train_real.py                       # standard run
    python train_real.py --seed 7 --min-samples-leaf 2

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix,
    f1_score, log_loss, top_k_accuracy_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.tree import DecisionTreeClassifier

# Force UTF-8 stdout for Windows consoles defaulting to cp1252.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

# Reuse feature-encoding + export logic from train_compare so we produce
# identical-shape JSONs to the ones the TS runtime already understands.
from train_compare import (
    CATEGORICAL_SINGLE, MULTISELECT, OBD_NUMERIC, LABEL_COL,
    build_features, export_tree_to_json,
)

ROOT       = Path(__file__).parent
DATA_DIR   = ROOT / "new_datasets"
REPORT_DIR = ROOT / "reports"

# Runtime tree file locations (what TypeScript loads at boot).
TIER1_JSON = ROOT / "exported_tree_tier1.json"
TIER2_JSON = ROOT / "exported_tree_tier2.json"
SYNTHETIC_BACKUP_1 = ROOT / "exported_tree_tier1_synthetic.json"
SYNTHETIC_BACKUP_2 = ROOT / "exported_tree_tier2_synthetic.json"

# Classes present in the questionnaire dataset that are NOT modelled by
# the runtime. Dropped with a warning rather than silently remapped.
UNSUPPORTED_CLASSES = {"HYDRO_LOCK", "ABS_SENSOR_RUST_CORROSION"}

# The 19 ML-diagnosable service types the runtime knows about (mirrors
# src/types/index.ts:ML_SERVICE_TYPES). Ordered for deterministic reporting.
ML_SERVICE_TYPES = [
    "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE", "ALTERNATOR_ISSUE",
    "STARTER_MOTOR",
    "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK", "ENGINE_OVERHEAT_SEVERE",
    "BELT_BROKEN",
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN",
    "BRAKE_PAD_WORN", "BRAKE_FAILURE",
    "CLUTCH_WORN", "TRANSMISSION_ISSUE",
    "SEVERE_MECHANICAL_TOW",
]


# ─────────────────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────────────────

def load_questionnaire() -> pd.DataFrame:
    """
    Load the validated questionnaire dataset. Every field expected by the
    runtime's TriageResponses type is either present or filled with the
    NOT_ASKED sentinel that the tree was originally trained to accept.

    Rows with service types outside the runtime catalog are dropped with
    a printed count so the reduction is auditable.
    """
    df = pd.read_excel(DATA_DIR / "questionnaire_dataset_validated.xlsx")
    original_n = len(df)

    unsupported = df["service_type"].isin(UNSUPPORTED_CLASSES)
    if unsupported.any():
        dropped = df[unsupported]["service_type"].value_counts().to_dict()
        print(f"[real] Dropping {unsupported.sum()} rows in unsupported classes: {dropped}")
        df = df[~unsupported].reset_index(drop=True)

    # Fill missing categorical fields with NOT_ASKED (the tree was trained
    # to treat NOT_ASKED as a valid category — see generate_dataset.py).
    for col in CATEGORICAL_SINGLE:
        if col in df.columns:
            df[col] = df[col].fillna("NOT_ASKED").replace("", "NOT_ASKED")
        else:
            df[col] = "NOT_ASKED"

    # Multi-selects: dataset may have them as pipe- or comma-delimited strings;
    # normalise to JSON arrays that build_features can parse.
    for col in MULTISELECT.keys():
        if col not in df.columns:
            df[col] = "[]"
            continue
        def _to_json_array(v):
            if pd.isna(v) or v == "":
                return "[]"
            if isinstance(v, str) and v.strip().startswith("["):
                return v
            # Split on common delimiters
            parts = [p.strip() for p in str(v).replace(";", ",").split(",") if p.strip()]
            return json.dumps(parts)
        df[col] = df[col].apply(_to_json_array)

    # The runtime uses `location_type` (COASTAL/HILL/URBAN/RURAL) but the
    # dataset gives us free-text `location_name`. Best-effort mapping:
    # everything except explicit hill/coastal cues becomes URBAN, since the
    # sample is Colombo-metro biased.
    if "location_type" not in df.columns:
        loc = df.get("location_name", pd.Series([""] * len(df))).fillna("").str.upper()
        df["location_type"] = np.where(
            loc.str.contains("KANDY|NUWARA|BADULLA|HATTON|ELLA"), "HILL",
            np.where(loc.str.contains("GALLE|MATARA|NEGOMBO|BENTOTA|HIKKADUWA|MOUNT LAVINIA|MORATUWA"), "COASTAL",
                     "URBAN"))
    if "vehicle_age_bucket" not in df.columns:
        # Not present in this dataset — default to 3_7 (most common Sri Lankan car age)
        df["vehicle_age_bucket"] = "3_7"

    print(f"[real] Loaded {len(df)} questionnaire rows ({original_n} original, {original_n - len(df)} dropped)")
    print(f"[real] Class balance: {df['service_type'].value_counts().to_dict()}")
    return df


def load_obd() -> pd.DataFrame:
    """
    Load the real OBD dataset. Columns match our runtime OBD_NUMERIC schema
    exactly (checked below). 15 examples per class × 19 classes = 285 rows.
    """
    df = pd.read_csv(DATA_DIR / "obd_dataset.csv")
    missing = set(OBD_NUMERIC) - set(df.columns)
    if missing:
        raise SystemExit(f"OBD dataset missing expected columns: {missing}")
    unsupported = df["service_type"].isin(UNSUPPORTED_CLASSES) | ~df["service_type"].isin(ML_SERVICE_TYPES)
    if unsupported.any():
        print(f"[real] Dropping {unsupported.sum()} OBD rows in unknown classes")
        df = df[~unsupported].reset_index(drop=True)
    print(f"[real] Loaded {len(df)} OBD rows ({df['service_type'].nunique()} classes)")
    return df


def join_for_tier2(q_df: pd.DataFrame, obd_df: pd.DataFrame, seed: int) -> pd.DataFrame:
    """
    Pair each questionnaire row with a randomly-sampled OBD row that shares
    its service_type. If a class has no OBD rows the questionnaire row is
    dropped (Tier 2 is defined as "questionnaire + OBD", so we can't include
    rows lacking OBD).

    The pairing is with-replacement — an OBD row can be re-used across
    multiple questionnaire rows. This is fine at our N since the alternative
    (drop questionnaire rows once OBD samples run out) shrinks the training
    set materially, hurting the tree.
    """
    rng = np.random.default_rng(seed)
    obd_by_class: dict[str, pd.DataFrame] = {
        cls: obd_df[obd_df["service_type"] == cls] for cls in obd_df["service_type"].unique()
    }
    rows: list[dict] = []
    dropped = 0
    for _, q_row in q_df.iterrows():
        pool = obd_by_class.get(q_row["service_type"])
        if pool is None or len(pool) == 0:
            dropped += 1
            continue
        obd_row = pool.sample(n=1, random_state=int(rng.integers(0, 2**31 - 1))).iloc[0]
        combined = q_row.to_dict()
        for c in OBD_NUMERIC:
            combined[c] = obd_row[c]
        rows.append(combined)
    joined = pd.DataFrame(rows)
    print(f"[real] Tier 2 join produced {len(joined)} rows (dropped {dropped} — no OBD for their class)")
    return joined


# ─────────────────────────────────────────────────────────────────────────
# Training + evaluation
# ─────────────────────────────────────────────────────────────────────────

def evaluate(model, X_test, y_test, all_classes) -> dict:
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)
    # Re-index proba columns to match all_classes.
    proba_full = np.zeros((len(X_test), len(all_classes)))
    for i, cls in enumerate(model.classes_):
        proba_full[:, all_classes.index(cls)] = y_proba[:, i]
    top3 = top_k_accuracy_score(y_test, proba_full, k=3, labels=all_classes)
    return {
        "accuracy":      float(accuracy_score(y_test, y_pred)),
        "top3_accuracy": float(top3),
        "macro_f1":      float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
        "weighted_f1":   float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
        "log_loss":      float(log_loss(y_test, proba_full, labels=all_classes)),
    }


def cv_score(model, X, y, k: int = 5) -> tuple[float, float, int]:
    from collections import Counter
    smallest = min(Counter(y).values())
    k_used = min(k, smallest)
    if k_used < 2:
        return float("nan"), float("nan"), k_used
    skf = StratifiedKFold(n_splits=k_used, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=skf, scoring="accuracy", n_jobs=-1)
    return float(scores.mean()), float(scores.std()), k_used


def plot_confusion(cm, classes, title: str, out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=classes, yticklabels=classes, ax=ax,
                cbar_kws={"label": "count"})
    ax.set_title(title)
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
    plt.xticks(rotation=45, ha="right"); plt.yticks(rotation=0)
    plt.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150)
    plt.close(fig)


def build_features_obd_only(df: pd.DataFrame):
    """
    Return (X, y, feature_names, encoders=None) using ONLY the numeric OBD
    columns — no categorical questionnaire or multi-select features. Used
    for the OBD-only ablation described in the paper (§ 7.1 ablation).

    Same row order and labels as `build_features(df, use_obd=True)` so
    train/test splits with the same random_state produce the same rows,
    guaranteeing an apples-to-apples comparison.
    """
    if not all(c in df.columns for c in OBD_NUMERIC):
        missing = [c for c in OBD_NUMERIC if c not in df.columns]
        raise ValueError(f"OBD-only feature builder needs columns: missing {missing}")
    X = df[OBD_NUMERIC].astype(float).to_numpy()
    y = df[LABEL_COL].to_numpy()
    return X, y, list(OBD_NUMERIC), None


def train_one_tier(
    df: pd.DataFrame,
    use_obd: bool,
    seed: int,
    min_samples_leaf: int,
    obd_only: bool = False,
) -> tuple[DecisionTreeClassifier, list[str], list[str], dict]:
    """Train a single-tier DecisionTree; return (model, feature_names, classes, metrics)."""
    if obd_only:
        X, y, feature_names, _ = build_features_obd_only(df)
    else:
        X, y, feature_names, _ = build_features(df, use_obd=use_obd)
    classes = sorted(set(y))

    # Stratified 80/20; if any class has only 1 sample we can't stratify —
    # fall back to random split with a warning.
    from collections import Counter
    thin = [c for c, n in Counter(y).items() if n < 2]
    if thin:
        print(f"[real] Warning: classes with <2 samples cannot be stratified: {thin}")
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=seed)
    else:
        X_tr, X_te, y_tr, y_te = train_test_split(
            X, y, test_size=0.2, random_state=seed, stratify=y,
        )

    model = DecisionTreeClassifier(
        random_state=seed,
        min_samples_leaf=min_samples_leaf,
        criterion="gini",
    )
    model.fit(X_tr, y_tr)

    holdout_metrics = evaluate(model, X_te, y_te, classes)
    cv_mean, cv_std, k_used = cv_score(model, X, y, k=5)
    holdout_metrics["cv_accuracy_mean"] = cv_mean
    holdout_metrics["cv_accuracy_std"]  = cv_std
    holdout_metrics["cv_k"]             = k_used
    holdout_metrics["n_train"]          = int(len(X_tr))
    holdout_metrics["n_test"]           = int(len(X_te))
    holdout_metrics["depth"]            = int(model.get_depth())
    holdout_metrics["n_leaves"]         = int(model.get_n_leaves())

    return model, feature_names, classes, holdout_metrics, (X_te, y_te)


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-samples-leaf", type=int, default=1)
    args = ap.parse_args()

    print("=" * 70)
    print("UADO — Real-data retraining pipeline")
    print("=" * 70)

    # ── Backup synthetic trees exactly once ─────────────────────────
    for src, dst in [(TIER1_JSON, SYNTHETIC_BACKUP_1), (TIER2_JSON, SYNTHETIC_BACKUP_2)]:
        if src.exists() and not dst.exists():
            shutil.copy(src, dst)
            print(f"[real] Backed up synthetic {src.name} → {dst.name}")

    # ── Load real data ───────────────────────────────────────────────
    q_df   = load_questionnaire()
    obd_df = load_obd()

    # ── Tier 1: questionnaire only ──────────────────────────────────
    print("\n--- Training Tier 1 (real questionnaire only) ---")
    m1, f1, c1, met1, _ = train_one_tier(q_df, use_obd=False, seed=args.seed, min_samples_leaf=args.min_samples_leaf)
    print(json.dumps(met1, indent=2))

    tree1_json = export_tree_to_json(m1, f1, c1)
    TIER1_JSON.write_text(json.dumps(tree1_json, indent=2), encoding="utf-8")
    print(f"[real] Wrote Tier 1 tree to {TIER1_JSON.name} (depth={met1['depth']}, leaves={met1['n_leaves']})")

    # Confusion matrix on holdout
    cm1_classes = c1
    _, _, _, _, (X_te1, y_te1) = train_one_tier(q_df, use_obd=False, seed=args.seed, min_samples_leaf=args.min_samples_leaf)
    y_pred1 = m1.predict(X_te1)
    cm1 = confusion_matrix(y_te1, y_pred1, labels=cm1_classes)
    plot_confusion(cm1, cm1_classes, "Tier 1 (Real Data) — Confusion Matrix",
                   REPORT_DIR / "real_confusion_tier1.png")

    # ── Tier 2: joined questionnaire + OBD ───────────────────────────
    print("\n--- Training Tier 2 (real questionnaire joined with real OBD) ---")
    joined = join_for_tier2(q_df, obd_df, seed=args.seed)
    m2, f2, c2, met2, _ = train_one_tier(joined, use_obd=True, seed=args.seed, min_samples_leaf=args.min_samples_leaf)
    print(json.dumps(met2, indent=2))

    tree2_json = export_tree_to_json(m2, f2, c2)
    TIER2_JSON.write_text(json.dumps(tree2_json, indent=2), encoding="utf-8")
    print(f"[real] Wrote Tier 2 tree to {TIER2_JSON.name} (depth={met2['depth']}, leaves={met2['n_leaves']})")

    _, _, _, _, (X_te2, y_te2) = train_one_tier(joined, use_obd=True, seed=args.seed, min_samples_leaf=args.min_samples_leaf)
    y_pred2 = m2.predict(X_te2)
    cm2 = confusion_matrix(y_te2, y_pred2, labels=c2)
    plot_confusion(cm2, c2, "Tier 2 (Real Data) — Confusion Matrix",
                   REPORT_DIR / "real_confusion_tier2.png")

    # ── OBD-only ablation: same rows, same split, OBD numerics only ─
    # Directly answers "why not just use OBD?" — the reviewer's obvious
    # question. Not deployed (no JSON export); purely for the paper's
    # empirical comparison. Uses the SAME joined DataFrame + same seed as
    # Tier 2 so train/test rows are identical → clean apples-to-apples.
    print("\n--- Training OBD-Only (ablation, not deployed) ---")
    m_obd, f_obd, c_obd, met_obd, (X_te_obd, y_te_obd) = train_one_tier(
        joined, use_obd=True, seed=args.seed,
        min_samples_leaf=args.min_samples_leaf, obd_only=True,
    )
    print(json.dumps(met_obd, indent=2))
    y_pred_obd = m_obd.predict(X_te_obd)
    cm_obd = confusion_matrix(y_te_obd, y_pred_obd, labels=c_obd)
    plot_confusion(cm_obd, c_obd, "OBD-Only (Real Data) — Confusion Matrix",
                   REPORT_DIR / "real_confusion_obd_only.png")

    # ── Coolant-family worked-example comparison ────────────────────
    # OBD-only vs Tier 2 confusion sub-matrix over the four coolant classes.
    # Reviewer-facing: does adding Q7_overheat_detail actually separate the
    # four coolant faults that OBD conflates (all present with high
    # coolant_temp_c → tree can't distinguish)?
    coolant_classes = [
        "COOLANT_LOW", "RADIATOR_HOSE_LEAK",
        "RADIATOR_FAN_ISSUE", "ENGINE_OVERHEAT_SEVERE",
    ]

    def _submatrix(cm, all_classes, subset):
        idx = [all_classes.index(c) for c in subset if c in all_classes]
        return cm[np.ix_(idx, idx)], [all_classes[i] for i in idx]

    sub_obd, sub_lbl_obd = _submatrix(cm_obd, c_obd, coolant_classes)
    sub_t2,  sub_lbl_t2  = _submatrix(cm2,    c2,    coolant_classes)

    # Side-by-side plot for the paper figure.
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, cm_sub, lbls, title in [
        (axes[0], sub_obd, sub_lbl_obd, "OBD-Only — Coolant Family (test set)"),
        (axes[1], sub_t2,  sub_lbl_t2,  "Tier 2 (Q+OBD) — Coolant Family (test set)"),
    ]:
        sns.heatmap(cm_sub, annot=True, fmt="d", cmap="Blues",
                    xticklabels=lbls, yticklabels=lbls, ax=ax,
                    cbar=False)
        ax.set_title(title, fontsize=11)
        ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
        ax.tick_params(axis="x", rotation=30)
        ax.tick_params(axis="y", rotation=0)
    plt.suptitle("Coolant-family disambiguation: OBD alone conflates; questionnaire separates",
                 fontsize=12, y=1.02)
    plt.tight_layout()
    coolant_path = REPORT_DIR / "real_coolant_family_comparison.png"
    plt.savefig(coolant_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[real] Coolant-family comparison saved to {coolant_path.name}")

    # Diagonal counts for the paper text ("N correct out of M on this class")
    diag_obd = {sub_lbl_obd[i]: (int(sub_obd[i, i]), int(sub_obd[i].sum())) for i in range(len(sub_lbl_obd))}
    diag_t2  = {sub_lbl_t2[i]:  (int(sub_t2[i, i]),  int(sub_t2[i].sum()))  for i in range(len(sub_lbl_t2))}

    # Family-vs-outside categorisation — the sub-matrix row sums only count
    # predictions that fall INSIDE the coolant subset. Additional evidence
    # comes from predictions that ESCAPED the family entirely, which is the
    # sharpest measure of how much the questionnaire helps.
    coolant_set = set(coolant_classes)
    def _categorise(y_true, y_pred):
        exact = right_family = escaped = 0
        for yt, yp in zip(y_true, y_pred):
            if yt not in coolant_set:
                continue
            if yt == yp:
                exact += 1
            elif yp in coolant_set:
                right_family += 1
            else:
                escaped += 1
        total = exact + right_family + escaped
        return {"total": total, "exact": exact,
                "right_family_wrong_class": right_family,
                "escaped_family_entirely": escaped}

    fam_obd = _categorise(y_te_obd, y_pred_obd)
    fam_t2  = _categorise(y_te2,    y_pred2)

    # ── Persist consolidated metrics report ──────────────────────────
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "seed":              args.seed,
        "min_samples_leaf":  args.min_samples_leaf,
        "tier1":             met1,
        "tier2":             met2,
        "obd_only":          met_obd,
        "tier1_classes":     c1,
        "tier2_classes":     c2,
        "obd_only_classes":  c_obd,
        "questionnaire_n":   int(len(q_df)),
        "obd_n":             int(len(obd_df)),
        "tier2_joined_n":    int(len(joined)),
        "coolant_family_ablation": {
            "obd_only_correct_over_total_per_class": diag_obd,
            "tier2_correct_over_total_per_class":    diag_t2,
            "obd_only_family_categorisation":        fam_obd,
            "tier2_family_categorisation":           fam_t2,
        },
    }
    with (REPORT_DIR / "real_data_metrics.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\n[real] Metrics saved to {REPORT_DIR / 'real_data_metrics.json'}")

    print("\n" + "=" * 70)
    print("SUMMARY (3-way ablation)")
    print("=" * 70)
    print(f"{'Config':22s} {'Holdout Acc':>12s} {'Top-3 Acc':>10s} {'5-fold CV Acc':>16s}   {'depth/leaves':>15s}")
    print("-" * 78)
    for name, m in [
        ("Tier 1 (Q only)",       met1),
        ("OBD-only (numeric)",    met_obd),
        ("Tier 2 (Q + OBD)",      met2),
    ]:
        print(f"{name:22s} {m['accuracy']*100:11.2f}%  {m['top3_accuracy']*100:9.2f}%  "
              f"{m['cv_accuracy_mean']*100:6.2f}% ± {m['cv_accuracy_std']*100:.2f}%   "
              f"{m['depth']:>4d}/{m['n_leaves']:<4d}")
    print("-" * 78)
    print("\nCoolant-family sub-matrix (test set):")
    print(f"{'Class':>28s}  {'OBD-only':>12s}  {'Tier 2 (Q+OBD)':>18s}")
    for cls in coolant_classes:
        obd_c, obd_n = diag_obd.get(cls, (0, 0))
        t2_c,  t2_n  = diag_t2.get(cls,  (0, 0))
        print(f"{cls:>28s}  {obd_c}/{obd_n:<10}  {t2_c}/{t2_n:<16}")

    print("\nCoolant-family categorisation (of N true-coolant test rows):")
    for name, fam in [("OBD-only", fam_obd), ("Tier 2 (Q+OBD)", fam_t2)]:
        t = fam["total"]
        e = fam["exact"]; rf = fam["right_family_wrong_class"]; ef = fam["escaped_family_entirely"]
        pct = lambda x: f"{100*x/t:.1f}%" if t else "n/a"
        print(f"  {name:15s} N={t}  exact={e} ({pct(e)})  "
              f"family-but-wrong-class={rf} ({pct(rf)})  "
              f"ESCAPED={ef} ({pct(ef)})")
    print("\nRuntime trees (Tier 1 + Tier 2) are REAL-DATA-TRAINED. Restart backend to pick them up.")
    print("OBD-only tree is NOT deployed (ablation only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
