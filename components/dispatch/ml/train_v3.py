"""
============================================================================
UADO Diagnostic Triage — v3 Training Pipeline
============================================================================

Trains Tier 1 and Tier 2 decision-tree diagnostic models on the v3 dataset
(989 questionnaire rows, 950 OBD rows). Follows the methodological rules
laid down in files/IMPLEMENTATION_GUIDE.md, in particular:

  (1) TEST SET IS 100% REAL rows — never synthetic. We split the REAL
      rows 80/20 first, then augment only the train fold with synthetic.
      Reported holdout numbers therefore reflect what the model would do
      on genuinely-unseen field data, not on the distribution its own
      synthetic augmentation was drawn from.

  (2) `detected_dtc` IS EXCLUDED from the feature set. An empirical
      audit found 108 of 120 expert-assigned DTCs to be unique to a
      single class (see § 7.1 in ARCHITECTURE.md-v2 and Future Work).
      Including the field would inflate accuracy by 15-30pp via pure
      label leakage. The DTC mapping remains valuable as a Future Work
      reference artefact.

  (3) Schema simplification: `location_type` and `vehicle_age_bucket`
      are not present in the v3 dataset (dropped per the cardinality
      audit); we do not add them back. `vehicle_make` and `fuel_type`
      are present but ignored (their runtime plumbing would require
      changes to the mobile form + backend types — deferred).

Four training configurations are run in a matrix and all reported:

    Tier 1 (Q only)        × DecisionTree
    Tier 1 (Q only)        × RandomForest
    Tier 2 (Q + numeric OBD) × DecisionTree
    Tier 2 (Q + numeric OBD) × RandomForest

The DT trees are exported as JSON (deployable to the TypeScript runtime).
RF results are reported for comparison only — the current runtime tree
walker doesn't support forest inference; deploying RF is scoped as Future
Work if the accuracy delta justifies the runtime change.

USAGE
-----
    python train_v3.py                       # standard run
    python train_v3.py --seed 7 --min-samples-leaf 2

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, f1_score, log_loss, top_k_accuracy_score,
)
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

# Force UTF-8 stdout on Windows.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix

# Reuse export/encoder helpers from train_compare so we produce the exact
# JSON shape the TypeScript runtime understands.
from train_compare import export_tree_to_json

ROOT       = Path(__file__).parent
DATA_DIR   = ROOT / "new_datasets" / "v3"
REPORT_DIR = ROOT / "reports"

TIER1_JSON            = ROOT / "exported_tree_tier1.json"
TIER2_JSON            = ROOT / "exported_tree_tier2.json"
SYNTHETIC_BACKUP_1    = ROOT / "exported_tree_tier1_synthetic.json"
SYNTHETIC_BACKUP_2    = ROOT / "exported_tree_tier2_synthetic.json"
V1_BACKUP_1           = ROOT / "exported_tree_tier1_v1_real.json"
V1_BACKUP_2           = ROOT / "exported_tree_tier2_v1_real.json"

REAL_SOURCES = {"real", "real_dtc_expert_retrofit"}

# ─── v3 schema (post-cardinality-audit) ──────────────────────────────────
# Note: location_type and vehicle_age_bucket dropped (not in v3 dataset).
# vehicle_make and fuel_type intentionally NOT trained on (would require
# mobile form + runtime type changes — future work).
CATEGORICAL_SINGLE_V3 = [
    "Q1_intent",
    "Q2_engine_start", "Q2b_running_issue",
    "Q3_sound", "Q3b_electrical",
    "Q4_noise_detail", "Q7_overheat_detail", "Q8_smoke_color",
    "Q_brake_detail", "Q_gear_detail",
    "Q6_smells",
    "recent_rain", "parked_overnight", "last_fueled",
]

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

# Runtime catalog — 19 ML classes. Anything outside this is dropped.
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

# ─── Data loading ────────────────────────────────────────────────────────

def load_questionnaire_v3() -> pd.DataFrame:
    """Load v3 questionnaire; keep only classes the runtime knows; fill NOT_ASKED."""
    df = pd.read_csv(DATA_DIR / "questionnaire_final_v3.csv")
    n_original = len(df)
    df = df[df[LABEL_COL].isin(ML_SERVICE_TYPES)].reset_index(drop=True)
    if len(df) < n_original:
        dropped_counts = pd.read_csv(DATA_DIR / "questionnaire_final_v3.csv")[LABEL_COL].value_counts()
        unsupported = {k: int(v) for k, v in dropped_counts.items() if k not in ML_SERVICE_TYPES}
        print(f"[v3] Dropping {n_original - len(df)} questionnaire rows in unsupported classes: {unsupported}")

    for col in CATEGORICAL_SINGLE_V3:
        if col in df.columns:
            df[col] = df[col].fillna("NOT_ASKED").replace("", "NOT_ASKED")
        else:
            df[col] = "NOT_ASKED"

    # Multi-selects normalised to JSON arrays.
    for col in MULTISELECT:
        if col not in df.columns:
            df[col] = "[]"
            continue
        def _to_json_array(v):
            if pd.isna(v) or v == "":
                return "[]"
            if isinstance(v, str) and v.strip().startswith("["):
                return v
            parts = [p.strip() for p in str(v).replace(";", ",").split(",") if p.strip()]
            return json.dumps(parts)
        df[col] = df[col].apply(_to_json_array)

    print(f"[v3] Questionnaire loaded: {len(df)} rows ({(df['source']=='real').sum()} real, "
          f"{(df['source']!='real').sum()} synthetic)")
    return df


def load_obd_v3() -> pd.DataFrame:
    """Load v3 OBD; keep only known ML classes; DROP detected_dtc (label-leaked)."""
    df = pd.read_csv(DATA_DIR / "obd_final_v3.csv")
    missing = set(OBD_NUMERIC) - set(df.columns)
    if missing:
        raise SystemExit(f"v3 OBD dataset missing expected columns: {missing}")
    df = df[df[LABEL_COL].isin(ML_SERVICE_TYPES)].reset_index(drop=True)
    # Drop detected_dtc from the feature set — DO NOT use as a feature.
    # See § 7.1 in ARCHITECTURE.md-v2 (label leakage audit).
    if "detected_dtc" in df.columns:
        df = df.drop(columns=["detected_dtc"])
    real_count = df["source"].isin(REAL_SOURCES).sum()
    print(f"[v3] OBD loaded: {len(df)} rows ({real_count} real, {len(df)-real_count} synthetic). "
          "detected_dtc column dropped from feature set.")
    return df


def join_for_tier2(q_df: pd.DataFrame, obd_df: pd.DataFrame, seed: int) -> pd.DataFrame:
    """
    Same service_type-based join as v1 (documented limitation, § 9). For
    each questionnaire row, sample one OBD row with the same service_type
    (with replacement).

    A joined row is considered REAL only if the QUESTIONNAIRE row was
    real — the OBD half is by construction independent of the incident.
    We tag the resulting `source_joined` column accordingly so the test
    split can filter on it.
    """
    rng = np.random.default_rng(seed)
    obd_by_class = {cls: g for cls, g in obd_df.groupby(LABEL_COL)}
    rows: list[dict] = []
    for _, q_row in q_df.iterrows():
        pool = obd_by_class.get(q_row[LABEL_COL])
        if pool is None or len(pool) == 0:
            continue
        obd_row = pool.sample(n=1, random_state=int(rng.integers(0, 2**31 - 1))).iloc[0]
        combined = q_row.to_dict()
        for c in OBD_NUMERIC:
            combined[c] = obd_row[c]
        combined["source_joined"] = "real" if q_row["source"] == "real" else "synthetic"
        rows.append(combined)
    joined = pd.DataFrame(rows)
    print(f"[v3] Tier 2 join produced {len(joined)} rows "
          f"({(joined['source_joined']=='real').sum()} real, "
          f"{(joined['source_joined']=='synthetic').sum()} synthetic)")
    return joined


# ─── Feature encoding ────────────────────────────────────────────────────

def build_features_v3(df: pd.DataFrame, use_obd: bool):
    """
    Encode the v3 schema for sklearn. Same shape as v1's build_features
    but with the v3-only CATEGORICAL_SINGLE_V3 list (no location_type /
    vehicle_age_bucket).
    """
    from sklearn.preprocessing import OneHotEncoder
    encoders = {}
    blocks, names = [], []

    for col in CATEGORICAL_SINGLE_V3:
        values = df[col].fillna("MISSING").replace("", "MISSING").to_numpy().reshape(-1, 1)
        enc = OneHotEncoder(sparse_output=False, handle_unknown="ignore")
        blocks.append(enc.fit_transform(values))
        encoders[col] = enc
        names.extend([f"{col}={cat}" for cat in enc.categories_[0]])

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
        blocks.append(block)
        names.extend([f"{col}={opt}" for opt in options])

    if use_obd and all(c in df.columns for c in OBD_NUMERIC):
        obd_block = df[OBD_NUMERIC].astype(float).to_numpy()
        blocks.append(obd_block)
        names.extend(OBD_NUMERIC)

    X = np.hstack(blocks)
    y = df[LABEL_COL].to_numpy()
    return X, y, names, encoders


# ─── Real-only holdout split ─────────────────────────────────────────────

def split_real_only_holdout(
    df: pd.DataFrame,
    source_col: str,
    seed: int,
    test_size: float = 0.2,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Load-bearing methodology: separate REAL from SYNTHETIC, split REAL
    stratified 80/20, then attach ALL synthetic rows to the train fold.
    The holdout test set is therefore 100% real rows.

    Falls back to non-stratified split when a class has <2 real rows
    (with a printed warning) rather than dropping the class.
    """
    real_mask = df[source_col].isin(REAL_SOURCES) if source_col == "source" \
        else df[source_col].eq("real")
    real = df[real_mask].reset_index(drop=True)
    synth = df[~real_mask].reset_index(drop=True)

    if len(real) == 0:
        raise SystemExit(f"No real rows found (source_col={source_col}). Cannot form a valid test set.")

    y_real = real[LABEL_COL].to_numpy()
    thin = [c for c, n in Counter(y_real).items() if n < 2]
    if thin:
        print(f"[v3] WARNING: classes with <2 real rows cannot be stratified: {thin}")
        train_real, test_real = train_test_split(real, test_size=test_size, random_state=seed)
    else:
        train_real, test_real = train_test_split(
            real, test_size=test_size, random_state=seed, stratify=y_real,
        )

    train = pd.concat([train_real, synth], ignore_index=True)
    return train, test_real


# ─── Evaluation ──────────────────────────────────────────────────────────

def evaluate(model, X_test, y_test, all_classes) -> dict:
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)
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


def plot_confusion(cm, classes, title: str, out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(11, 9))
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


# ─── Single training run ────────────────────────────────────────────────

def train_config(
    train_df: pd.DataFrame,
    test_df:  pd.DataFrame,
    use_obd:  bool,
    model_kind: str,
    seed: int,
    min_samples_leaf: int,
):
    """One (tier × model) training + evaluation cycle."""
    X_tr, y_tr, feature_names, _ = build_features_v3(train_df, use_obd=use_obd)
    X_te, y_te, _,             _ = build_features_v3(test_df,  use_obd=use_obd)

    # build_features encodes train and test independently — feature name
    # lists can drift if a category appears in one and not the other. We
    # reconcile by re-encoding test on the training encoder's columns.
    # Simplest: refit an encoder on the union of train+test.
    combined = pd.concat([train_df, test_df], ignore_index=True)
    X_all, y_all, feature_names, _ = build_features_v3(combined, use_obd=use_obd)
    n_tr = len(train_df)
    X_tr, X_te = X_all[:n_tr], X_all[n_tr:]
    y_tr, y_te = y_all[:n_tr], y_all[n_tr:]

    if model_kind == "dt":
        model = DecisionTreeClassifier(
            random_state=seed, min_samples_leaf=min_samples_leaf, criterion="gini",
        )
    elif model_kind == "rf":
        model = RandomForestClassifier(
            n_estimators=200, random_state=seed,
            min_samples_leaf=min_samples_leaf, n_jobs=-1,
        )
    else:
        raise ValueError(f"unknown model_kind: {model_kind}")
    model.fit(X_tr, y_tr)

    classes = sorted(set(y_tr) | set(y_te))
    metrics = evaluate(model, X_te, y_te, classes)
    metrics["n_train"] = int(len(X_tr))
    metrics["n_test"]  = int(len(X_te))
    if model_kind == "dt":
        metrics["depth"]    = int(model.get_depth())
        metrics["n_leaves"] = int(model.get_n_leaves())
    else:
        metrics["n_estimators"]     = int(model.n_estimators)
        metrics["avg_depth"]        = float(np.mean([t.get_depth()    for t in model.estimators_]))
        metrics["avg_n_leaves"]     = float(np.mean([t.get_n_leaves() for t in model.estimators_]))

    return model, feature_names, classes, metrics, (X_te, y_te)


# ─── Main ────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-samples-leaf", type=int, default=1)
    args = ap.parse_args()

    print("=" * 70)
    print("UADO — v3 real-data retraining pipeline")
    print("=" * 70)

    # ── Backups ──────────────────────────────────────────────────────
    # First run: preserve the currently-deployed (v1-real) trees as
    # *_v1_real.json for the paper's before/after comparison.
    for src, dst in [(TIER1_JSON, V1_BACKUP_1), (TIER2_JSON, V1_BACKUP_2)]:
        if src.exists() and not dst.exists():
            shutil.copy(src, dst)
            print(f"[v3] Backed up v1-real {src.name} -> {dst.name}")

    # ── Load ────────────────────────────────────────────────────────
    q_df   = load_questionnaire_v3()
    obd_df = load_obd_v3()

    # ── Tier 1 splits (real-only holdout) ───────────────────────────
    print("\n--- Splitting Tier 1 (real-only holdout) ---")
    t1_train, t1_test = split_real_only_holdout(q_df, source_col="source", seed=args.seed)
    print(f"[v3] Tier 1 split: train={len(t1_train)} (real+synth), test={len(t1_test)} (real only)")

    # ── Tier 1 × {DT, RF} ────────────────────────────────────────────
    print("\n--- Training Tier 1 x DecisionTree ---")
    m1_dt, f1_dt, c1_dt, met_t1_dt, _ = train_config(
        t1_train, t1_test, use_obd=False, model_kind="dt",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    print(json.dumps(met_t1_dt, indent=2))

    print("\n--- Training Tier 1 x RandomForest ---")
    m1_rf, _, _, met_t1_rf, _ = train_config(
        t1_train, t1_test, use_obd=False, model_kind="rf",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    print(json.dumps(met_t1_rf, indent=2))

    # Deploy the DT (runtime tree walker doesn't support RF yet).
    tree1_json = export_tree_to_json(m1_dt, f1_dt, c1_dt)
    TIER1_JSON.write_text(json.dumps(tree1_json, indent=2), encoding="utf-8")
    print(f"[v3] Wrote Tier 1 DT to {TIER1_JSON.name}")

    # Confusion matrix (DT, holdout).
    _, _, _, _, (X_te1, y_te1) = train_config(
        t1_train, t1_test, use_obd=False, model_kind="dt",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    y_pred = m1_dt.predict(X_te1)
    cm = confusion_matrix(y_te1, y_pred, labels=c1_dt)
    plot_confusion(cm, c1_dt, "Tier 1 v3 DT — Confusion Matrix (real-only test)",
                   REPORT_DIR / "v3_confusion_tier1_dt.png")

    # ── Tier 2: join then split real-only ───────────────────────────
    print("\n--- Training Tier 2 (joined questionnaire + OBD) ---")
    joined = join_for_tier2(q_df, obd_df, seed=args.seed)
    t2_train, t2_test = split_real_only_holdout(joined, source_col="source_joined", seed=args.seed)
    print(f"[v3] Tier 2 split: train={len(t2_train)} (real+synth), test={len(t2_test)} (real only)")

    print("\n--- Training Tier 2 x DecisionTree ---")
    m2_dt, f2_dt, c2_dt, met_t2_dt, _ = train_config(
        t2_train, t2_test, use_obd=True, model_kind="dt",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    print(json.dumps(met_t2_dt, indent=2))

    print("\n--- Training Tier 2 x RandomForest ---")
    m2_rf, _, _, met_t2_rf, _ = train_config(
        t2_train, t2_test, use_obd=True, model_kind="rf",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    print(json.dumps(met_t2_rf, indent=2))

    tree2_json = export_tree_to_json(m2_dt, f2_dt, c2_dt)
    TIER2_JSON.write_text(json.dumps(tree2_json, indent=2), encoding="utf-8")
    print(f"[v3] Wrote Tier 2 DT to {TIER2_JSON.name}")

    _, _, _, _, (X_te2, y_te2) = train_config(
        t2_train, t2_test, use_obd=True, model_kind="dt",
        seed=args.seed, min_samples_leaf=args.min_samples_leaf,
    )
    y_pred2 = m2_dt.predict(X_te2)
    cm2 = confusion_matrix(y_te2, y_pred2, labels=c2_dt)
    plot_confusion(cm2, c2_dt, "Tier 2 v3 DT — Confusion Matrix (real-only test)",
                   REPORT_DIR / "v3_confusion_tier2_dt.png")

    # ── Persist report ──────────────────────────────────────────────
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "protocol": {
            "seed":              args.seed,
            "min_samples_leaf":  args.min_samples_leaf,
            "test_set_source":   "real only (source in {real, real_dtc_expert_retrofit})",
            "detected_dtc_used": False,
            "reason_dtc_excluded": (
                "Empirical audit: 108/120 expert-assigned DTCs are unique to a "
                "single class by construction; including as feature would inflate "
                "accuracy 15-30pp via label leakage. See ARCHITECTURE-v2.md §7.1."
            ),
        },
        "tier1_dt": met_t1_dt,
        "tier1_rf": met_t1_rf,
        "tier2_dt": met_t2_dt,
        "tier2_rf": met_t2_rf,
        "tier1_train_n": int(len(t1_train)),
        "tier1_test_n":  int(len(t1_test)),
        "tier2_train_n": int(len(t2_train)),
        "tier2_test_n":  int(len(t2_test)),
    }
    (REPORT_DIR / "v3_metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n[v3] Metrics saved to {REPORT_DIR / 'v3_metrics.json'}")

    # ── Summary ─────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("SUMMARY — v3 (real-only holdout test set, detected_dtc EXCLUDED)")
    print("=" * 78)
    print(f"{'Config':22s} {'Holdout Acc':>12s} {'Top-3':>8s} {'Macro F1':>10s} {'Log Loss':>10s}")
    print("-" * 78)
    for name, m in [
        ("Tier 1 DT",     met_t1_dt),
        ("Tier 1 RF",     met_t1_rf),
        ("Tier 2 DT",     met_t2_dt),
        ("Tier 2 RF",     met_t2_rf),
    ]:
        print(f"{name:22s} {m['accuracy']*100:11.2f}% {m['top3_accuracy']*100:7.2f}% "
              f"{m['macro_f1']:10.4f} {m['log_loss']:10.4f}")
    print("-" * 78)
    dt1_gain = (met_t1_rf['accuracy'] - met_t1_dt['accuracy']) * 100
    dt2_gain = (met_t2_rf['accuracy'] - met_t2_dt['accuracy']) * 100
    print(f"RF gains vs DT:  Tier 1: {dt1_gain:+.2f}pp   Tier 2: {dt2_gain:+.2f}pp")
    tier_gain = (met_t2_dt['accuracy'] - met_t1_dt['accuracy']) * 100
    print(f"Tier 2 vs Tier 1 (both DT):  {tier_gain:+.2f}pp")
    print()
    print("Deployed to runtime: Tier 1 DT + Tier 2 DT (RF deployment is Future Work).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
