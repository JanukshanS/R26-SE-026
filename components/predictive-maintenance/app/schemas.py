from __future__ import annotations

from typing import List
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


class TripBatch(BaseModel):
    trip_id: str = Field(..., description="UUID string uniquely identifying the trip")
    vehicle_id: str
    driver_id: str
    start_timestamp: str = Field(..., description="ISO-8601 datetime string")
    obd_readings: List[OBDReading] = Field(..., min_length=2)
    imu_readings: List[IMUReading] = Field(
        ...,
        min_length=5,
        description="Mobile phone sensor at 2-min intervals. min 5 readings = 10-min trip.",
    )


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
