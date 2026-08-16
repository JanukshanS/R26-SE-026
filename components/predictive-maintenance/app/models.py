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


class ServiceRecord(Base):
    """Append-only log of maintenance events.

    This is the runtime, normalised form of what the simulator emits as
    data/service_records.json ({vehicle: {component: [odometer_at_replacement,
    ...]}}) - that file has always been the right data shape, it just was never
    readable at runtime.

    NEVER updated in place. A wrong record is superseded by a newer one so the
    history stays auditable: "we estimated 100,000 km, the driver later said
    120,000" is a fact worth keeping, not something to overwrite.

    NOT NULL is fine on a brand-new table: app/migrations.py refuses NOT NULL
    only for ALTER TABLE ADD COLUMN against a table that already has rows.
    These tables are created by Base.metadata.create_all, which has no such
    restriction.
    """

    __tablename__ = "service_records"

    # String PK to match the client's ServiceRecord.id (typed `string` in
    # apps/mobile/lib/maintenanceApi.ts) - same choice as TripMetrics.trip_id.
    id = Column(String(36), primary_key=True)
    # NOTE: the plate string, matching TripMetrics.vehicle_id. Changing a plate
    # already orphans trips; it now also orphans the baseline and the whole
    # service history. The Supabase vehicle UUID is the right long-term key.
    vehicle_id = Column(String(64), nullable=False, index=True)
    # require_user()'s subject, stamped on write so another account cannot
    # rewrite this vehicle's history by guessing the plate.
    logged_by = Column(String(64), nullable=True)

    component = Column(String(16), nullable=False)     # engine|brake|tire|battery|full_service
    service_type = Column(String(24), nullable=False)
    service_date = Column(String(32), nullable=False)  # ISO-8601, client-supplied
    created_at = Column(String(32), nullable=False)    # ISO-8601, server clock

    # km already on the PART when this record was logged: 0 for a fresh
    # replacement, 41000 for "these tyres went on 41,000 km ago".
    km_on_component = Column(Float, nullable=False)
    # Vehicle odometer when the record was logged. Server-computed and stored
    # rather than recomputed, so the record stays a fixed historical fact.
    odometer_km_at_service = Column(Float, nullable=False)
    # The load-bearing derived value: odometer at which this part went in.
    #   install_km = odometer_km_at_service - km_on_component
    install_km = Column(Float, nullable=False)

    # How install_km was arrived at. The UI must never present an inferred
    # value as a stated fact, and this is what lets it say "estimated".
    basis = Column(String(24), nullable=False)  # user|inferred_schedule|inferred_original|unknown
    # The expected life that produced an inferred value; NULL when basis=user.
    # Stored so a later change to COMPONENT_EXPECTED_LIFE_KM cannot silently
    # reinterpret old estimates.
    expected_life_km_at_estimate = Column(Float, nullable=True)

    item_name = Column(String(120), nullable=True)
    is_original = Column(String(16), nullable=True)  # original|used
    garage_name = Column(String(120), nullable=True)
    cost_lkr = Column(Float, nullable=True)
    notes = Column(String(500), nullable=True)


class VehicleBaseline(Base):
    """What the odometer read before this app had seen a single metre.

    Separate from service_records because it is a VEHICLE-level fact rather than
    a per-component event, and because it is the one value corrected when the
    driver edits current_mileage in Supabase.
    """

    __tablename__ = "vehicle_baseline"

    vehicle_id = Column(String(64), primary_key=True)
    owner_id = Column(String(64), nullable=True)
    condition = Column(String(8), nullable=False)  # new|used

    baseline_odometer_km = Column(Float, nullable=False)
    # Sum of trip distance_km at the instant this baseline was written, so the
    # odometer is a pure arithmetic offset:
    #   odometer = baseline + (sum of all trips now) - trip_km_at_baseline
    # Chosen over "trips recorded after recorded_at" because it needs no clock
    # comparison, and because it makes a driver's odometer edit an authoritative
    # RESET - which is what a driver means when they correct it.
    trip_km_at_baseline = Column(Float, nullable=False)

    recorded_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)


class ComponentHealthFloor(Base):
    """Lowest health ever observed for a component. Health never rises above it.

    Parts do not heal. But health used to be computed purely from a rolling
    average of driving behaviour, so a few gentle trips made the number go UP -
    56% then 64% then 67% - which told the driver their brake pads had recovered.
    They had not; the driver had simply braked less that week.

    This records the worst reading seen so far and clamps future answers to it.
    The floor is deleted when a service record puts a NEW part in, which is the
    only event that genuinely resets wear.

    Deliberately a separate table rather than a column on trip_metrics: it is a
    per-vehicle-per-component running fact, not a property of any one trip.
    """

    __tablename__ = "component_health_floor"

    vehicle_id = Column(String(64), primary_key=True)
    component = Column(String(16), primary_key=True)
    health_pct = Column(Float, nullable=False)
    rul_km = Column(Float, nullable=False)
    observed_at = Column(String(32), nullable=False)
