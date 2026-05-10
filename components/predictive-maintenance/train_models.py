"""
Phase 3 — Model Training Script
=================================
Loads the ground-truth RUL training dataset produced by
generate_training_data.py, then trains and saves:

  Random Forest  (sklearn)  ->  models/{component}_rf.joblib
  Gradient Boost (XGBoost)  ->  models/{component}_gb.joblib

Each model predicts Remaining Useful Life (km) for one component.
Features are OBD-II + mobile IMU derived metrics.  Labels are km-based
RUL values computed from simulated service records.

Components: engine | brake | tire | battery
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

# ---------------------------------------------------------------------------
# Feature columns per component — must match COMPONENT_FEATURE_MAP in
# app/routers/predict.py and the columns produced by generate_training_data.py
# ---------------------------------------------------------------------------
FEATURE_SETS: Dict[str, List[str]] = {
    "engine":  ["avg_rpm", "max_coolant_temp_c", "ltft_std"],
    "brake":   ["braking_frequency", "avg_deceleration_intensity"],
    "tire":    ["cornering_frequency", "avg_speed_kmh", "total_mileage_km"],
    "battery": ["voltage_std", "min_battery_voltage_v", "avg_iat_c"],
}

LABEL_COLS: Dict[str, str] = {
    "engine":  "engine_rul_km",
    "brake":   "brake_rul_km",
    "tire":    "tire_rul_km",
    "battery": "battery_rul_km",
}

RANDOM_STATE = 42


# ---------------------------------------------------------------------------
# Model hyperparameters
# ---------------------------------------------------------------------------

def _build_rf() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=2,
        max_features="sqrt",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )


def _build_gb() -> XGBRegressor:
    return XGBRegressor(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.04,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        objective="reg:squarederror",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        verbosity=0,
    )


# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

def _evaluate(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    return {
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae":  float(mean_absolute_error(y_true, y_pred)),
        "r2":   float(r2_score(y_true, y_pred)),
    }


def _train_component(
    component: str,
    X_train: np.ndarray,
    X_test: np.ndarray,
    y_train: np.ndarray,
    y_test: np.ndarray,
    model_dir: str,
) -> Tuple[Dict, Dict]:
    """Train RF + GB for one component, save both, return metrics."""

    # Random Forest
    rf = _build_rf()
    rf.fit(X_train, y_train)
    rf_metrics = _evaluate(y_test, rf.predict(X_test))
    joblib.dump(rf, os.path.join(model_dir, f"{component}_rf.joblib"))

    # Gradient Boosting (XGBoost)
    gb = _build_gb()
    gb.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    gb_metrics = _evaluate(y_test, gb.predict(X_test))
    joblib.dump(gb, os.path.join(model_dir, f"{component}_gb.joblib"))

    return rf_metrics, gb_metrics


def main(
    data_path: str = "data/rul_training_dataset.csv",
    model_dir: str = "models",
) -> None:
    os.makedirs(model_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Load dataset
    # ------------------------------------------------------------------
    print(f"Loading training data from '{data_path}' ...")
    df = pd.read_csv(data_path)
    print(f"  Rows: {len(df):,}   Columns: {df.shape[1]}")
    print(f"  Vehicles: {df['vehicle_id'].nunique()}   "
          f"Profiles: {df['driving_profile'].value_counts().to_dict()}")

    # Drop rows where any RUL label is 0 (vehicle past last replacement —
    # these are edge-case extrapolations, not useful for training RUL)
    before = len(df)
    df = df[(df["engine_rul_km"] > 0) & (df["brake_rul_km"] > 0) &
            (df["tire_rul_km"] > 0) & (df["battery_rul_km"] > 0)]
    print(f"  Dropped {before - len(df)} rows with RUL=0. Training on {len(df):,} rows.\n")

    # ------------------------------------------------------------------
    # Train one RF + one GB model per component
    # ------------------------------------------------------------------
    header = f"{'Component':<12}  {'Model':<5}  {'RMSE (km)':>12}  {'MAE (km)':>12}  {'R²':>7}"
    print(header)
    print("-" * len(header))

    best_models: Dict[str, Dict] = {}   # populated below, saved to JSON
    all_metrics: Dict[str, Dict] = {}   # full RF + GB metrics per component

    for component, features in FEATURE_SETS.items():
        X = df[features].values
        y = df[LABEL_COLS[component]].values

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_STATE
        )

        rf_m, gb_m = _train_component(
            component, X_train, X_test, y_train, y_test, model_dir
        )

        # Decide winner by R² (higher is better)
        winner = "rf" if rf_m["r2"] >= gb_m["r2"] else "gb"
        best_models[component] = {
            "algorithm": winner,
            "r2":   round(rf_m["r2"] if winner == "rf" else gb_m["r2"], 4),
            "rmse": round(rf_m["rmse"] if winner == "rf" else gb_m["rmse"], 1),
            "mae":  round(rf_m["mae"]  if winner == "rf" else gb_m["mae"],  1),
        }
        all_metrics[component] = {
            "features": features,
            "train_rows": len(X_train),
            "test_rows":  len(X_test),
            "random_forest": {
                "r2":   round(rf_m["r2"],   4),
                "rmse": round(rf_m["rmse"], 1),
                "mae":  round(rf_m["mae"],  1),
                "is_best": winner == "rf",
            },
            "gradient_boosting": {
                "r2":   round(gb_m["r2"],   4),
                "rmse": round(gb_m["rmse"], 1),
                "mae":  round(gb_m["mae"],  1),
                "is_best": winner == "gb",
            },
        }

        print(f"{component:<12}  {'RF':<5}  {rf_m['rmse']:>12,.0f}  "
              f"{rf_m['mae']:>12,.0f}  {rf_m['r2']:>7.4f}"
              f"  {'<-- BEST' if winner == 'rf' else ''}")
        print(f"{'':12}  {'GB':<5}  {gb_m['rmse']:>12,.0f}  "
              f"{gb_m['mae']:>12,.0f}  {gb_m['r2']:>7.4f}"
              f"  {'<-- BEST' if winner == 'gb' else ''}")

    # Save best model selection so the API can load it at startup
    best_path = os.path.join(model_dir, "best_models.json")
    with open(best_path, "w", encoding="utf-8") as fh:
        json.dump(best_models, fh, indent=2)

    # Save full metrics so the /models/metrics endpoint can serve them
    metrics_path = os.path.join(model_dir, "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as fh:
        json.dump(all_metrics, fh, indent=2)

    print(f"\nBest model per component:")
    for comp, info in best_models.items():
        print(f"  {comp:<10} -> {info['algorithm'].upper()}  "
              f"(R²={info['r2']:.4f}, RMSE={info['rmse']:,.0f} km)")

    print(f"\nAll 8 models + best_models.json + metrics.json saved to '{model_dir}/'")
    print("Restart the FastAPI server to load the updated models.")


if __name__ == "__main__":
    main()
