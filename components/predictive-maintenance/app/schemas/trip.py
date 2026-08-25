from __future__ import annotations

from typing import Dict, List, Optional
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


class DTCReading(BaseModel):
    """One trouble code as the phone read it."""

    code: str = Field(..., description='e.g. "P0301"')
    status: str = Field(
        "confirmed",
        description="confirmed (mode 03) | pending (mode 07) | permanent (mode 0A)",
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

    # ── Diagnostics (additive; absent from every legacy client) ───────────
    # Codes read from modes 03 and 07 during this trip.
    dtcs: List[DTCReading] = Field(default_factory=list)
    # WHETHER THE READ ITSELF WORKED, which is a different question from
    # whether any codes came back. An adapter that did not answer produces the
    # same empty list as a car with nothing wrong, and without this flag the
    # server would read that as "all faults cleared" and wipe live faults off
    # the driver's screen. Defaults to False so a client that does not send it
    # can add codes but can never close one.
    dtc_read_ok: bool = False
    # Mode 02 snapshots, keyed by code: the sensor values the ECU stored at the
    # moment the fault set. Shape varies by vehicle, so it is free-form.
    freeze_frames: Dict[str, Dict[str, float]] = Field(default_factory=dict)


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

    # ── Paging, on the per-vehicle endpoint only ──────────────────────────
    # Absent on /vehicles/summary, which still returns every trip it has.
    #
    # The aggregates ABOVE always describe the WHOLE history, never just the
    # page: trip_count, total_distance_km and the averages are computed in SQL
    # across every trip for the vehicle. Only `trips` is windowed. Paging the
    # aggregates too would mean a driver's total mileage changed as they
    # scrolled, which is worse than not paging at all.
    has_more: Optional[bool] = None
    next_offset: Optional[int] = None


class ComponentHealth(BaseModel):
    component: str
    health_pct: float
    status: str                 # Good / Fair / Poor / Critical
    predicted_rul_km: float
    max_lifespan_km: int
    confidence_note: str

    # ── Wear baseline (additive; all None for a vehicle with no baseline) ──
    # km this specific part has run since it went in, and the odometer reading
    # at which that happened.
    km_on_component: Optional[float] = None
    install_km: Optional[float] = None
    # How install_km was arrived at: user | inferred_schedule |
    # inferred_original | unknown. Paired with is_estimated so the UI can
    # never present a guess as a stated fact.
    baseline_basis: Optional[str] = None

    # Live trouble codes filed against this component. Separate from
    # health_pct on purpose: a misfire does not consume brake pad life, so it
    # must not move a wear number. It may however raise urgency.
    faults: List["FaultOut"] = []
    is_estimated: Optional[bool] = None
    # Which term produced predicted_rul_km: "wear" (mileage since install) or
    # "model" (sensor signature). Exposed because the two can disagree, and a
    # silent flip between them would make the number look unstable for no
    # visible reason.
    rul_source: Optional[str] = None


class EngineOilStatus(BaseModel):
    """Oil is a service INTERVAL, not a component lifespan.

    km_since_change is None when no oil change has ever been logged - the UI
    must say "not recorded" rather than implying the oil is fresh.
    """
    interval_km: int
    km_since_change: Optional[float] = None
    km_remaining: Optional[float] = None
    is_overdue: bool = False
    last_change_odometer_km: Optional[float] = None


class FaultOut(BaseModel):
    """A live trouble code, as the driver sees it."""

    code: str
    title: str
    component: str                  # engine | brake | tire | battery | other
    severity: str                   # urgent | soon | monitor
    status: str                     # confirmed | pending | permanent
    likely_causes: List[str] = []
    # What this damages if left alone. THE PREDICTIVE PART, and curated data
    # rather than model output - see app/services/fault_catalogue.py.
    leads_to: List[str] = []
    cost_multiplier: Optional[float] = None
    first_seen_at: str
    last_seen_at: str
    times_seen: int
    # Greater than zero means it was cleared and came back, which usually
    # means the light was reset without the cause being fixed.
    recurrences: int = 0
    # True when the code was matched by family rather than by an exact entry,
    # so the UI can hedge instead of naming a defect it cannot identify.
    is_generic: bool = False
    freeze_frame: Optional[Dict[str, float]] = None


class VehicleHealthResponse(BaseModel):
    vehicle_id: str
    overall_health_pct: float
    overall_status: str
    trip_count: int
    total_mileage_km: float
    components: List[ComponentHealth]
    timestamp: str

    # Every live fault, including those filed under "other" which belong to no
    # component card and would otherwise be invisible.
    faults: List["FaultOut"] = []
    # False when no trip has yet reported a successful code read, so the UI can
    # say "not checked yet" instead of implying a clean bill of health.
    faults_checked: bool = False

    # ── Additive ──────────────────────────────────────────────────────────
    # The real odometer (baseline + trips) vs what the app has recorded itself.
    # total_mileage_km above now equals odometer_km when a baseline exists, so
    # these make the difference inspectable rather than implied.
    odometer_km: Optional[float] = None
    baseline_odometer_km: Optional[float] = None
    recorded_trip_km: Optional[float] = None
    # True while too little driving has been recorded for the averages to have
    # settled. The number is still shown - hiding it would be worse - but the UI
    # should mark it as provisional rather than final.
    is_provisional: Optional[bool] = None
    min_distance_for_confidence_km: Optional[float] = None
    vehicle_condition: Optional[str] = None      # new | used
    engine_oil: Optional[EngineOilStatus] = None


# ---------------------------------------------------------------------------
# Service records and vehicle baseline
# ---------------------------------------------------------------------------

class ServiceRecordCreate(BaseModel):
    """Matches apps/mobile/lib/maintenanceApi.ts ServiceRecordCreate verbatim,
    plus one additive optional field.

    `basis` is the whole reason the "not sure" rule lives on the server:
      absent / "user" -> km_on_component is taken at face value. Today's
                         add-service-record.tsx sends km_on_component: 0, which
                         correctly means "replaced today, zero km on the part".
      "unknown"       -> the driver said "not sure": km_on_component is IGNORED
                         and the server infers the install point from the
                         odometer. Without this flag the inference would have to
                         be duplicated in TypeScript and the two would drift.
    """
    component: str                              # engine|brake|tire|battery|full_service
    service_type: str
    service_date: str
    km_on_component: float = 0.0
    basis: Optional[str] = Field(None, pattern="^(user|unknown)$")
    item_name: Optional[str] = None
    is_original: Optional[str] = Field(None, pattern="^(original|used)$")
    garage_name: Optional[str] = None
    cost_lkr: Optional[float] = None
    notes: Optional[str] = None


class ServiceRecordOut(BaseModel):
    id: str
    vehicle_id: str
    component: str
    service_type: str
    service_date: str
    created_at: str
    km_on_component: float
    odometer_km_at_service: float
    install_km: float
    basis: str
    is_estimated: bool
    resets_window: bool
    expected_life_km_at_estimate: Optional[float] = None
    item_name: Optional[str] = None
    is_original: Optional[str] = None
    garage_name: Optional[str] = None
    cost_lkr: Optional[float] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class LatestServiceEntry(BaseModel):
    service_type: str
    service_date: str
    km_on_component: float
    resets_window: bool
    install_km: float
    km_on_component_now: float
    basis: str
    is_estimated: bool


class VehicleBaselineUpsert(BaseModel):
    odometer_km: float = Field(..., ge=0, le=2_000_000)
    condition: str = Field(..., pattern="^(new|used)$")


class VehicleBaselineOut(BaseModel):
    vehicle_id: str
    condition: str
    baseline_odometer_km: float
    odometer_km: float
    recorded_trip_km: float
    recorded_at: str
    updated_at: str
