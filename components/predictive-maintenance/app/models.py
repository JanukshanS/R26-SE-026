from sqlalchemy import Column, Integer, String, Float
from app.database import Base


class TripMetrics(Base):
    __tablename__ = "trip_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trip_id = Column(String(36), unique=True, nullable=False, index=True)
    vehicle_id = Column(String(64), nullable=False, index=True)
    driver_id = Column(String(64), nullable=False)
    start_timestamp = Column(String(32), nullable=False)
    stored_at = Column(String(32), nullable=False)

    duration_minutes = Column(Float, nullable=False)
    distance_km = Column(Float, nullable=False)

    # Engine features
    avg_rpm = Column(Float, nullable=False)
    max_rpm = Column(Float, nullable=False)
    avg_engine_load = Column(Float, nullable=False)
    max_coolant_temp_c = Column(Float, nullable=False)
    ltft_std = Column(Float, nullable=False)

    # Brake features
    braking_events = Column(Integer, nullable=False)
    braking_frequency = Column(Float, nullable=False)
    avg_deceleration_intensity = Column(Float, nullable=False)

    # Tire features
    cornering_events = Column(Integer, nullable=False)
    cornering_frequency = Column(Float, nullable=False)
    avg_speed_kmh = Column(Float, nullable=False)
    total_mileage_km = Column(Float, nullable=False)

    # Battery features
    avg_battery_voltage_v = Column(Float, nullable=False)
    min_battery_voltage_v = Column(Float, nullable=False)
    voltage_std = Column(Float, nullable=False)
    avg_iat_c = Column(Float, nullable=False)

    # ── Driver-behaviour analytics ────────────────────────────────────────
    # NULL on every row ingested before this feature, and on any trip from an
    # older app build. All nullable with no default: that is the only form
    # SQLite's ADD COLUMN accepts unconditionally (see app/migrations.py), and
    # it keeps existing rows valid. NULL means "not measured" - the UI must
    # never render it as zero, which would be a false claim about the driver.
    #
    # These are ANALYTICS ONLY. None of them is an ML input; tests/test_ml_contract.py
    # fails if one ever leaks into COMPONENT_FEATURE_MAP.
    behavior_source = Column(String(24), nullable=True)
    # 1 (NULL) = duration/distance derived from array length; 2 = from real
    # sample offsets. The two are on different scales and total_mileage_km sums
    # both forever, so the history has to be self-describing.
    metrics_version = Column(Integer, nullable=True)

    steering_reversal_rate = Column(Float, nullable=True)
    steering_smoothness_index = Column(Float, nullable=True)
    swerve_events = Column(Integer, nullable=True)
    yaw_rate_p95 = Column(Float, nullable=True)
    yaw_rate_max = Column(Float, nullable=True)

    harsh_accel_events = Column(Integer, nullable=True)
    avg_accel_intensity = Column(Float, nullable=True)
    max_decel_ms2 = Column(Float, nullable=True)
    longitudinal_jerk_rms = Column(Float, nullable=True)

    harsh_cornering_events = Column(Integer, nullable=True)
    lateral_g_max = Column(Float, nullable=True)
    lateral_g_p95 = Column(Float, nullable=True)

    imu_sample_count = Column(Integer, nullable=True)
    mount_stable = Column(Integer, nullable=True)   # 0/1/NULL
    axis_confidence = Column(Float, nullable=True)
    synthetic_obd_count = Column(Integer, nullable=True)
    driver_score = Column(Float, nullable=True)
