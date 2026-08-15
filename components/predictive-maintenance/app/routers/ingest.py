from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from scipy.signal import find_peaks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TripMetrics
from app.schemas import IMUReading, OBDReading, TripBatch, TripMetricsResponse, TripSummary, VehicleTripSummary

router = APIRouter()


# ---------------------------------------------------------------------------
# Feature extraction helpers
# ---------------------------------------------------------------------------

# Sampling on the phone runs on plain JS setInterval timers, which the OS
# suspends while the app is backgrounded. A trip that spends 40 minutes in the
# background therefore produces one 40-minute gap between consecutive readings.
# Integrating 50 km/h across it would invent 33 km of driving that never
# happened — and distance feeds total_mileage_km, which feeds the tire model.
# So every interval is capped. This is load-bearing, not defensive padding.
MAX_SAMPLE_GAP_SEC = 900.0      # 15 min
MAX_TRIP_SEC = 24 * 3600.0
MIN_DISTANCE_KM = 0.5
MIN_TRIP_MINUTES = 2.0


def _effective_intervals(offsets: List[int], fallback_step_sec: float) -> np.ndarray:
    """Per-sample interval widths in seconds, validated and gap-capped.

    Returns np.diff(offsets) when the offsets are usable, otherwise a uniform
    fallback of `fallback_step_sec`. "Usable" means: >= 2 readings, no negative
    or decreasing values, and a total span in (0, MAX_TRIP_SEC].

    BACKWARDS COMPATIBILITY: clients before the real-offset change emit offsets
    of exactly index * step, so np.diff() of a legacy batch is a constant vector
    equal to `step` — identical to the fallback. Reading real offsets is
    therefore a no-op for old clients by construction, and needs no version flag.
    """
    n = len(offsets)
    if n < 2:
        return np.array([], dtype=float)

    arr = np.asarray(offsets, dtype=float)
    diffs = np.diff(arr)
    span = float(arr[-1] - arr[0])

    if np.any(diffs < 0) or span <= 0 or span > MAX_TRIP_SEC:
        print(
            f"[ingest] offsets unusable (span={span:.0f}s, min_diff={diffs.min():.0f}s) "
            f"- falling back to a uniform {fallback_step_sec:.0f}s spacing"
        )
        return np.full(n - 1, float(fallback_step_sec))

    capped = np.minimum(diffs, MAX_SAMPLE_GAP_SEC)
    n_capped = int(np.sum(diffs > MAX_SAMPLE_GAP_SEC))
    if n_capped:
        print(
            f"[ingest] capped {n_capped} sampling gap(s) at {MAX_SAMPLE_GAP_SEC:.0f}s "
            f"(largest was {diffs.max():.0f}s - app was probably backgrounded)"
        )
    return capped


def _estimate_distance_km(obd_readings: List[OBDReading]) -> float:
    """Trapezoidal integration of speed over the ACTUAL sample offsets.

    Previously this assumed a fixed 300 s spacing per reading and summed one
    rectangle per reading, so distance was a function of ARRAY LENGTH rather
    than elapsed time: a dev-mode trip sampling every 30 s reported 10x the real
    distance, and the trailing half-interval was double-counted.

    Worked example — 5 readings, 300 s apart, constant 60 km/h (a real 20-minute
    trip): old code gave 5 * 60/12 = 25 km; this gives 4 * 300 * 60/3600 = 20 km.
    """
    dt = _effective_intervals([r.timestamp_offset_sec for r in obd_readings], 300.0)
    if dt.size == 0:
        return MIN_DISTANCE_KM

    v = np.array([r.speed_kmh for r in obd_readings], dtype=float)
    km = float(np.sum(0.5 * (v[:-1] + v[1:]) * dt) / 3600.0)
    return max(km, MIN_DISTANCE_KM)


def _estimate_duration_minutes(batch: TripBatch) -> float:
    """Trip length from the real sample offsets, preferring the wall clock.

    `end_timestamp` (when a client sends it) is authoritative — it measures the
    trip, not the sampling. But it comes from the device clock, so it is only
    trusted when it agrees with the sensor-derived span to within 20%; that
    guards against clock changes, timezone junk and unparseable strings.
    """
    obd_dt = _effective_intervals([r.timestamp_offset_sec for r in batch.obd_readings], 300.0)
    imu_dt = _effective_intervals([r.timestamp_offset_sec for r in batch.imu_readings], 120.0)
    sensor_sec = max(float(np.sum(obd_dt)), float(np.sum(imu_dt)))

    wall_sec = None
    end_ts = getattr(batch, "end_timestamp", None)
    if end_ts:
        try:
            start = datetime.fromisoformat(batch.start_timestamp.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_ts.replace("Z", "+00:00"))
            candidate = (end - start).total_seconds()
            if candidate > 0:
                wall_sec = candidate
        except (ValueError, AttributeError):
            print(f"[ingest] end_timestamp '{end_ts}' unparseable - using sensor-derived duration")

    if wall_sec is not None and sensor_sec > 0 and abs(wall_sec - sensor_sec) <= 0.2 * sensor_sec:
        chosen, source = wall_sec, "wall-clock"
    else:
        chosen, source = sensor_sec, "sensor-offsets"

    print(f"[ingest] duration source={source} ({chosen / 60.0:.1f} min)")
    return max(chosen, MIN_TRIP_MINUTES * 60.0) / 60.0


def _extract_obd_features(obd_readings: List[OBDReading]) -> dict:
    rpms = np.array([r.rpm for r in obd_readings])
    loads = np.array([r.engine_load_percent for r in obd_readings])
    coolant = np.array([r.coolant_temp_c for r in obd_readings])
    ltft = np.array([r.ltft_percent for r in obd_readings])
    voltage = np.array([r.battery_voltage_v for r in obd_readings])
    iat = np.array([r.intake_air_temp_c for r in obd_readings])
    speed = np.array([r.speed_kmh for r in obd_readings])

    return {
        "avg_rpm": float(np.mean(rpms)),
        "max_rpm": float(np.max(rpms)),
        "avg_engine_load": float(np.mean(loads)),
        "max_coolant_temp_c": float(np.max(coolant)),
        "ltft_std": float(np.std(ltft)),
        "avg_speed_kmh": float(np.mean(speed)),
        "avg_battery_voltage_v": float(np.mean(voltage)),
        "min_battery_voltage_v": float(np.min(voltage)),
        "voltage_std": float(np.std(voltage)),
        "avg_iat_c": float(np.mean(iat)),
    }


def _zero_imu_features() -> dict:
    """All-zero behaviour features, for when detection could not run at all.

    Paired with behavior_source="legacy_insufficient" on the row so that a later
    reader can tell "we looked and there were no events" from "we could not
    look". Without that distinction the brake model reads these zeros as a
    perfectly gentle driver, which is a claim the data does not support.
    """
    return {
        "braking_events": 0,
        "braking_frequency": 0.0,
        "avg_deceleration_intensity": 0.0,
        "cornering_events": 0,
        "cornering_frequency": 0.0,
    }


# find_peaks can never return index 0 or len-1 (a peak needs both neighbours),
# so fewer than 3 readings can only ever yield zero events.
MIN_READINGS_FOR_PEAKS = 3

# Heuristic weights for the 0-100 smoothness score. Module-level so they can be
# tuned without touching the handler. NOT validated against ground truth: this
# is a UI summary, never a model input.
SCORE_W = {
    "brake": 1.5,
    "accel": 1.5,
    "corner": 1.0,
    "swerve": 3.0,
    "jerk": 8.0,
    "yaw_jerk": 60.0,
    "steering": 0.4,
}

# Ordinary driving must score well, so each term only penalises the EXCESS over
# a normal level. The event allowances are anchored to the same profiles the RUL
# models were trained on (generate_training_data.py): gentle 10, moderate 20 and
# aggressive 45 braking events per 100 km. Without these allowances a plainly
# moderate driver scored 0/100, which is worse than useless in the UI - it looks
# broken and it tells the driver nothing.
EVENT_FREE_PER_100KM = {
    "brake": 15.0,   # between the gentle and moderate profiles
    "accel": 10.0,
    "corner": 15.0,
    "swerve": 0.0,   # no free allowance: a swerve is never routine
}
JERK_FREE_ALLOWANCE = 0.8       # m/s^3 - below this is comfortable driving
YAW_JERK_FREE_ALLOWANCE = 0.12  # rad/s^2
STEERING_FREE_ALLOWANCE = 12.0  # reversals/min - ordinary city driving


def _behavior_to_metrics(b, distance_km: float) -> dict:
    """Map the device's behaviour block onto the legacy brake/corner columns.

    The five legacy columns are ML inputs, so they keep their exact meaning and
    units; the device just measures them far better than find_peaks over
    one-sample-per-2-minutes could. Everything else lands in the new columns.
    """
    braking = b.harsh_braking_events or 0
    cornering = b.harsh_cornering_events or 0
    return {
        "braking_events": int(braking),
        "braking_frequency": float(braking / distance_km),
        "avg_deceleration_intensity": float(b.avg_decel_intensity or 0.0),
        "cornering_events": int(cornering),
        "cornering_frequency": float(cornering / distance_km),
    }


def _behavior_columns(b) -> dict:
    """New analytics columns. All-None when no behaviour block was sent, so a
    legacy trip stores NULL rather than a fabricated zero."""
    if b is None:
        return {}
    return {
        "steering_reversal_rate": b.steering_reversal_rate,
        "steering_smoothness_index": b.steering_smoothness_index,
        "swerve_events": b.swerve_events,
        "yaw_rate_p95": b.yaw_rate_p95,
        "yaw_rate_max": b.yaw_rate_max,
        "harsh_accel_events": b.harsh_accel_events,
        "avg_accel_intensity": b.avg_accel_intensity,
        "max_decel_ms2": b.max_decel_ms2,
        "longitudinal_jerk_rms": b.longitudinal_jerk_rms,
        "harsh_cornering_events": b.harsh_cornering_events,
        "lateral_g_max": b.lateral_g_max,
        "lateral_g_p95": b.lateral_g_p95,
        "imu_sample_count": b.imu_sample_count,
        "mount_stable": None if b.mount_stable is None else int(b.mount_stable),
        "axis_confidence": b.axis_confidence,
        "synthetic_obd_count": b.synthetic_obd_count,
    }


def _driver_score(b, distance_km: float) -> Optional[float]:
    """0-100 smoothness score, or None when nothing usable was measured.

    Event terms are normalised per 100 km so a long motorway run is not punished
    for accumulating more absolute events than a short city hop. Returns None
    rather than 100 when the behaviour block is empty, so the UI can say "not
    measured" instead of implying a perfect drive.
    """
    if b is None:
        return None
    fields = [
        b.harsh_braking_events, b.harsh_accel_events, b.harsh_cornering_events,
        b.swerve_events, b.longitudinal_jerk_rms, b.steering_smoothness_index,
        b.steering_reversal_rate,
    ]
    if all(f is None for f in fields):
        return None

    def excess(n, kind: str) -> float:
        """Events per 100 km beyond what ordinary driving already involves."""
        per100 = (n or 0) * 100.0 / max(distance_km, 0.1)
        return max(0.0, per100 - EVENT_FREE_PER_100KM[kind])

    penalty = (
        SCORE_W["brake"] * excess(b.harsh_braking_events, "brake")
        + SCORE_W["accel"] * excess(b.harsh_accel_events, "accel")
        + SCORE_W["corner"] * excess(b.harsh_cornering_events, "corner")
        + SCORE_W["swerve"] * excess(b.swerve_events, "swerve")
        + SCORE_W["jerk"] * max(0.0, (b.longitudinal_jerk_rms or 0.0) - JERK_FREE_ALLOWANCE)
        + SCORE_W["yaw_jerk"] * max(0.0, (b.steering_smoothness_index or 0.0) - YAW_JERK_FREE_ALLOWANCE)
        + SCORE_W["steering"] * max(0.0, (b.steering_reversal_rate or 0.0) - STEERING_FREE_ALLOWANCE)
    )
    return round(max(0.0, 100.0 - penalty), 1)


def _analyze_imu(imu_readings: List[IMUReading], distance_km: float) -> dict:
    """
    Detect harsh braking and cornering events from 2-minute-interval IMU snapshots.

    Braking  : accel_z < -3.0 m/s²  → invert sign, find peaks above 3.0
    Cornering: |gyro_z| > 0.6 rad/s  → find peaks in absolute yaw rate

    distance=2 means at least 2 sensor readings (= 4 minutes) between counted
    events, preventing the same event being double-counted across adjacent
    2-minute snapshots.

    LEGACY PATH. Superseded by the on-device `behavior` block, which analyses the
    full 4 Hz stream instead of one peak-per-2-minutes and can therefore separate
    a pothole from a brake. Kept for clients that predate it.
    """
    accel_z = np.array([r.accel_z for r in imu_readings])
    gyro_z = np.array([r.gyro_z for r in imu_readings])

    # --- Braking ---
    braking_peaks, _ = find_peaks(
        -accel_z,          # invert: hard braking becomes a positive peak
        height=3.0,        # |accel_z| > 3.0 m/s²
        distance=2,        # min 2 readings (4 min) between distinct events
        prominence=1.5,    # must stand out from the local baseline
    )
    if len(braking_peaks) > 0:
        avg_decel = float(np.mean(np.abs(accel_z[braking_peaks])))
    else:
        avg_decel = 0.0

    # --- Cornering ---
    cornering_peaks, _ = find_peaks(
        np.abs(gyro_z),
        height=0.6,        # |gyro_z| > 0.6 rad/s
        distance=2,
        prominence=0.3,
    )

    braking_freq = len(braking_peaks) / distance_km
    cornering_freq = len(cornering_peaks) / distance_km

    return {
        "braking_events": int(len(braking_peaks)),
        "braking_frequency": float(braking_freq),
        "avg_deceleration_intensity": avg_decel,
        "cornering_events": int(len(cornering_peaks)),
        "cornering_frequency": float(cornering_freq),
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/process-trip", response_model=TripMetricsResponse, status_code=201)
def process_trip(batch: TripBatch, db: Session = Depends(get_db)) -> TripMetricsResponse:
    """
    Ingest a raw trip batch, extract OBD + IMU features, persist to SQLite,
    and return the computed trip metrics.
    """
    # Duplicate guard
    existing = db.query(TripMetrics).filter(TripMetrics.trip_id == batch.trip_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Trip '{batch.trip_id}' already processed.")

    duration_minutes = _estimate_duration_minutes(batch)
    distance_km = _estimate_distance_km(batch.obd_readings)

    # Semantic rejection lives here rather than in the schema so the client gets
    # a usable reason instead of a Pydantic shape error. The mobile queue treats
    # 422 as PERMANENTLY invalid and discards without retrying — which is the
    # correct disposition for an auto-recorded false start.
    if duration_minutes < MIN_TRIP_MINUTES or distance_km <= MIN_DISTANCE_KM:
        print(
            f"[ingest] REJECTED trip {batch.trip_id}: too short "
            f"({duration_minutes:.1f} min, {distance_km:.2f} km)"
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"Trip too short to analyse "
                f"({duration_minutes:.1f} min, {distance_km:.2f} km)."
            ),
        )

    obd_features = _extract_obd_features(batch.obd_readings)

    b = batch.behavior
    if b is not None:
        # Preferred: the device analysed the full 4 Hz stream.
        imu_features = _behavior_to_metrics(b, distance_km)
        behavior_source = "device"
    elif len(batch.imu_readings) >= MIN_READINGS_FOR_PEAKS:
        imu_features = _analyze_imu(batch.imu_readings, distance_km)
        behavior_source = "legacy_imu_peaks"
    else:
        imu_features = _zero_imu_features()
        behavior_source = "legacy_insufficient"
        print(
            f"[ingest] trip {batch.trip_id}: only {len(batch.imu_readings)} IMU reading(s) - "
            f"find_peaks needs >= {MIN_READINGS_FOR_PEAKS}; recording zeros as UNKNOWN, "
            f"not as 'no events'"
        )

    record = TripMetrics(
        trip_id=batch.trip_id,
        vehicle_id=batch.vehicle_id,
        driver_id=batch.driver_id,
        start_timestamp=batch.start_timestamp,
        stored_at=datetime.now(timezone.utc).isoformat(),
        duration_minutes=duration_minutes,
        distance_km=distance_km,
        total_mileage_km=distance_km,
        behavior_source=behavior_source,
        metrics_version=2,
        driver_score=_driver_score(b, distance_km),
        **obd_features,
        **imu_features,
        **_behavior_columns(b),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    print(
        f"[ingest] stored trip {batch.trip_id} vehicle={batch.vehicle_id} "
        f"source={behavior_source} dur={duration_minutes:.1f}min dist={distance_km:.2f}km "
        f"obd={len(batch.obd_readings)} imu={len(batch.imu_readings)} "
        f"brake_ev={imu_features['braking_events']} corner_ev={imu_features['cornering_events']}"
    )

    return TripMetricsResponse.model_validate(record)


@router.get("/vehicles/summary", response_model=List[VehicleTripSummary])
def vehicles_summary(db: Session = Depends(get_db)) -> List[VehicleTripSummary]:
    """
    Return a trip summary for every vehicle that has at least one recorded trip.
    Each entry includes vehicle-level aggregates and a chronological list of individual trips.
    """
    # All distinct vehicle IDs ordered alphabetically
    vehicle_ids = [
        row[0]
        for row in db.query(TripMetrics.vehicle_id)
        .distinct()
        .order_by(TripMetrics.vehicle_id)
        .all()
    ]

    if not vehicle_ids:
        return []

    summaries: List[VehicleTripSummary] = []

    for vid in vehicle_ids:
        trips = (
            db.query(TripMetrics)
            .filter(TripMetrics.vehicle_id == vid)
            .order_by(TripMetrics.start_timestamp)
            .all()
        )

        total_distance    = sum(t.distance_km for t in trips)
        total_duration    = sum(t.duration_minutes for t in trips)
        total_braking     = sum(t.braking_events for t in trips)
        total_cornering   = sum(t.cornering_events for t in trips)
        avg_speed         = float(np.mean([t.avg_speed_kmh for t in trips]))
        avg_rpm           = float(np.mean([t.avg_rpm for t in trips]))
        latest_trip       = max(t.start_timestamp for t in trips)

        trip_list = [TripSummary.model_validate(t) for t in trips]

        summaries.append(
            VehicleTripSummary(
                vehicle_id=vid,
                trip_count=len(trips),
                total_distance_km=round(total_distance, 2),
                total_duration_minutes=round(total_duration, 1),
                avg_speed_kmh=round(avg_speed, 1),
                avg_rpm=round(avg_rpm, 0),
                total_braking_events=total_braking,
                total_cornering_events=total_cornering,
                latest_trip=latest_trip,
                trips=trip_list,
            )
        )

    return summaries
