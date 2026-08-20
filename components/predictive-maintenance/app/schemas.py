from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class OBDReading(BaseModel):
    timestamp_offset_sec: int = Field(..., description="Seconds since trip start (multiples of 300)")
    rpm: float = Field(..., ge=0, le=8000)
    speed_kmh: float = Field(..., ge=0, le=300)
    coolant_temp_c: float = Field(..., ge=0, le=150)
    battery_voltage_v: float = Field(..., ge=0, le=20)
    ltft_percent: float = Field(..., ge=-30, le=30, description="Long-Term Fuel Trim %")
    throttle_percent: float = Field(..., ge=0, le=100)
    engine_load_percent: float = Field(..., ge=0, le=100)
    intake_air_temp_c: float = Field(..., ge=-20, le=100)


class IMUReading(BaseModel):
    timestamp_offset_sec: int = Field(..., description="Seconds since trip start (every 120 s = 2-min interval)")
    accel_x: float = Field(..., description="Lateral acceleration m/s²")
    accel_y: float = Field(..., description="Longitudinal acceleration m/s²")
    accel_z: float = Field(..., description="Vertical / braking proxy m/s²")
    gyro_x: float = Field(..., description="Roll rate rad/s")
    gyro_y: float = Field(..., description="Pitch rate rad/s")
    gyro_z: float = Field(..., description="Yaw rate / cornering proxy rad/s")


class TripBehavior(BaseModel):
    """Driver-behaviour metrics computed ON DEVICE from the raw 4 Hz IMU stream.

    Computed on the phone rather than here because they are properties of the
    full stream - steering reversal rate, jerk, percentiles - and the batch only
    carries one summarised IMU row per window. Summarising first destroys them.

    EVERY FIELD IS OPTIONAL, for two reasons: app builds already in the field
    send no behaviour block at all, and a short trip with no turning never
    establishes which way the vehicle points, so it cannot separate braking from
    acceleration (see axis_confidence). Absent means "not measured" and must
    never be rendered as zero.
    """
    # Steering
    steering_reversal_rate: Optional[float] = Field(
        None, ge=0, description="Yaw-rate reversals per minute (deadband 0.035 rad/s)"
    )
    steering_smoothness_index: Optional[float] = Field(
        None, ge=0, description="RMS yaw acceleration, rad/s^2. Lower is smoother."
    )
    swerve_events: Optional[int] = Field(
        None, ge=0, description="Sharp reversal pairs within 3 s - lane-change-abort signature"
    )
    yaw_rate_p95: Optional[float] = Field(None, ge=0, le=10)
    yaw_rate_max: Optional[float] = Field(None, ge=0, le=10)

    # Longitudinal
    harsh_braking_events: Optional[int] = Field(None, ge=0)
    harsh_accel_events: Optional[int] = Field(None, ge=0)
    avg_decel_intensity: Optional[float] = Field(None, ge=0, le=30)
    avg_accel_intensity: Optional[float] = Field(None, ge=0, le=30)
    max_decel_ms2: Optional[float] = Field(None, ge=0, le=30)
    longitudinal_jerk_rms: Optional[float] = Field(None, ge=0)

    # Lateral
    harsh_cornering_events: Optional[int] = Field(None, ge=0)
    lateral_g_max: Optional[float] = Field(None, ge=0, le=3)
    lateral_g_p95: Optional[float] = Field(None, ge=0, le=3)

    # Provenance / quality
    imu_sample_count: Optional[int] = Field(None, ge=0)
    mount_stable: Optional[bool] = Field(
        None, description="False if the phone moved >15 deg during the trip"
    )
    axis_confidence: Optional[float] = Field(
        None, ge=0, le=1,
        description="Confidence in the learned forward axis. Below ~0.35 the "
                    "brake/accelerate split was assumed, not measured.",
    )
    sensor_dropout_sec: Optional[float] = Field(None, ge=0)
    synthetic_obd_count: Optional[int] = Field(
        None, ge=0, description="OBD samples skipped because the dongle stopped answering"
    )


class TripBatch(BaseModel):
    trip_id: str = Field(..., description="UUID string uniquely identifying the trip")
    vehicle_id: str
    driver_id: str
    start_timestamp: str = Field(..., description="ISO-8601 datetime string")
    obd_readings: List[OBDReading] = Field(..., min_length=2)
    imu_readings: List[IMUReading] = Field(
        ...,
        min_length=2,
        description=(
            "Mobile phone sensor readings. Two is the structural floor (one interval). "
            "Whether a trip is long enough to analyse is decided in the handler from "
            "real elapsed time, not from how many samples happened to arrive — see "
            "MIN_TRIP_MINUTES / MIN_DISTANCE_KM in routers/ingest.py, which return a "
            "422 with a readable reason."
        ),
    )
    end_timestamp: Optional[str] = Field(
        None, description="ISO-8601 wall-clock end. Preferred for duration when it "
                          "agrees with the sample offsets to within 20%."
    )
    client_schema_version: Optional[int] = Field(
        None, description="2 = real timestamp offsets + behaviour block. Absent = legacy client."
    )
    behavior: Optional[TripBehavior] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class TripMetricsResponse(BaseModel):
    trip_id: str
    vehicle_id: str
    driver_id: str
    start_timestamp: str
    stored_at: str
    duration_minutes: float
    distance_km: float
    # Engine
    avg_rpm: float
    max_rpm: float
    avg_engine_load: float
    max_coolant_temp_c: float
    ltft_std: float
    # Brake
    braking_events: int
    braking_frequency: float
    avg_deceleration_intensity: float
    # Tire
    cornering_events: int
    cornering_frequency: float
    avg_speed_kmh: float
    total_mileage_km: float
    # Battery
    avg_battery_voltage_v: float
    min_battery_voltage_v: float
    voltage_std: float
    avg_iat_c: float

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Prediction models
# ---------------------------------------------------------------------------

class PredictionRequest(BaseModel):
    vehicle_id: str = "unknown"
    # Engine inputs
    avg_rpm: float
    max_coolant_temp_c: float
    ltft_std: float
    # Brake inputs
    braking_frequency: float
    avg_deceleration_intensity: float
    # Tire inputs
    cornering_frequency: float
    avg_speed_kmh: float
    total_mileage_km: float
    # Battery inputs
    voltage_std: float
    min_battery_voltage_v: float
    avg_iat_c: float


class ComponentRUL(BaseModel):
    component: str
    predicted_rul_km: float
    confidence_note: str


class PredictionResponse(BaseModel):
    vehicle_id: str
    algorithm: str
    predictions: List[ComponentRUL]
    timestamp: str


class VehicleRULResponse(BaseModel):
    vehicle_id: str
    trip_count: int
    total_mileage_km: float
    algorithm: str
    predictions: List[ComponentRUL]
    timestamp: str


class TripSummary(BaseModel):
    trip_id: str
    driver_id: str
    start_timestamp: str
    duration_minutes: float
    distance_km: float
    avg_speed_kmh: float
    avg_rpm: float
    max_coolant_temp_c: float
    braking_events: int
    cornering_events: int
    avg_battery_voltage_v: float

    model_config = {"from_attributes": True}


class VehicleTripSummary(BaseModel):
    vehicle_id: str
    trip_count: int
    total_distance_km: float
    total_duration_minutes: float
    avg_speed_kmh: float
    avg_rpm: float
    total_braking_events: int
    total_cornering_events: int
    latest_trip: str
    trips: List[TripSummary]


class ComponentHealth(BaseModel):
    component: str
    health_pct: float
    status: str                 # Good / Fair / Poor / Critical
    predicted_rul_km: float
    max_lifespan_km: int
    confidence_note: str


class VehicleHealthResponse(BaseModel):
    vehicle_id: str
    overall_health_pct: float
    overall_status: str
    trip_count: int
    total_mileage_km: float
    components: List[ComponentHealth]
    timestamp: str
