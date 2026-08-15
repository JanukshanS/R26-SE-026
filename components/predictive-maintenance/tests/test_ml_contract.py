"""The ML feature contract is frozen. This test is the tripwire.

Features are passed to the models POSITIONALLY as a bare ``np.array([[...]])``
(see ``predict.py`` ``_features_for``/``predict``), so the ORDER of each list is
as much a part of the contract as its contents. Adding, removing or reordering
an entry without retraining silently corrupts every prediction — the model still
returns a confident number, it is just answering a different question.

The same list is written down in three places that can drift independently:

    1. ``app/routers/predict.py``  COMPONENT_FEATURE_MAP  — what inference reads
    2. ``train_models.py``         FEATURE_SETS           — what training used
    3. ``models/metrics.json``     [component]["features"] — what the shipped
                                                            .joblib files expect

``metrics.json`` is the authority among them: it is written by the training run
that produced the current ``.joblib`` files, so it describes the models as they
actually exist on disk rather than as the source happens to describe them today.

Driver-behaviour analytics (steering, swerve, harsh acceleration, driver score)
are deliberately NOT in this contract. They are stored and displayed but never
fed to a model, precisely so that work cannot require a retrain. If a change
makes this test fail, that is the decision being reversed — retrain and update
the frozen literal below, do not just edit it to make the test pass.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers.predict import COMPONENT_FEATURE_MAP
from train_models import FEATURE_SETS

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"

# The contract, frozen. 11 features across 4 components.
FROZEN_FEATURES = {
    "engine": ["avg_rpm", "max_coolant_temp_c", "ltft_std"],
    "brake": ["braking_frequency", "avg_deceleration_intensity"],
    "tire": ["cornering_frequency", "avg_speed_kmh", "total_mileage_km"],
    "battery": ["voltage_std", "min_battery_voltage_v", "avg_iat_c"],
}


def test_inference_features_match_the_frozen_contract():
    assert COMPONENT_FEATURE_MAP == FROZEN_FEATURES


def test_training_features_match_inference():
    """Training and inference must agree, or the models are fed the wrong columns."""
    assert FEATURE_SETS == COMPONENT_FEATURE_MAP


def test_shipped_models_expect_these_features():
    """metrics.json describes the .joblib files actually on disk."""
    metrics_path = MODELS_DIR / "metrics.json"
    if not metrics_path.exists():
        # Models are a build artifact; skip rather than fail a fresh checkout.
        import pytest

        pytest.skip("models/metrics.json not present — run train_models.py")

    metrics = json.loads(metrics_path.read_text())
    for component, features in FROZEN_FEATURES.items():
        assert component in metrics, f"metrics.json is missing '{component}'"
        assert metrics[component]["features"] == features, (
            f"'{component}' on disk was trained on {metrics[component]['features']} "
            f"but the code will feed it {features}"
        )


def test_behaviour_analytics_are_not_model_inputs():
    """Guards the analytics-only decision for the driver-behaviour work.

    These columns exist on trip_metrics and are shown in the app, but must never
    reach a model without an explicit retrain.
    """
    behaviour_only = {
        "steering_reversal_rate",
        "steering_smoothness_index",
        "swerve_events",
        "yaw_rate_p95",
        "yaw_rate_max",
        "harsh_accel_events",
        "avg_accel_intensity",
        "max_decel_ms2",
        "longitudinal_jerk_rms",
        "harsh_cornering_events",
        "lateral_g_max",
        "lateral_g_p95",
        "driver_score",
        "axis_confidence",
        "mount_stable",
        "imu_sample_count",
        "synthetic_obd_count",
        "behavior_source",
        "metrics_version",
    }
    used = {f for feats in COMPONENT_FEATURE_MAP.values() for f in feats}
    leaked = used & behaviour_only
    assert not leaked, f"behaviour analytics leaked into the ML contract: {sorted(leaked)}"


if __name__ == "__main__":
    test_inference_features_match_the_frozen_contract()
    test_training_features_match_inference()
    test_shipped_models_expect_these_features()
    test_behaviour_analytics_are_not_model_inputs()
    print("ok")
