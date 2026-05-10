from __future__ import annotations

from datetime import datetime, timezone
from typing import List

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

def _estimate_distance_km(obd_readings: List[OBDReading]) -> float:
    """Trapezoidal integration of speed over 5-min OBD intervals."""
    dt_hours = 300 / 3600  # each interval = 5 min = 1/12 hour
    distance = sum(r.speed_kmh * dt_hours for r in obd_readings)
    return max(float(distance), 0.1)


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


def _analyze_imu(imu_readings: List[IMUReading], distance_km: float) -> dict:
    """
    Detect harsh braking and cornering events from 2-minute-interval IMU snapshots.

    Braking  : accel_z < -3.0 m/s²  → invert sign, find peaks above 3.0
    Cornering: |gyro_z| > 0.6 rad/s  → find peaks in absolute yaw rate

    distance=2 means at least 2 sensor readings (= 4 minutes) between counted
    events, preventing the same event being double-counted across adjacent
    2-minute snapshots.
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

    # IMU snapshots are at 2-minute intervals → each reading = 2 minutes of trip time
    duration_minutes = len(batch.imu_readings) * 2.0
    distance_km = _estimate_distance_km(batch.obd_readings)

    obd_features = _extract_obd_features(batch.obd_readings)
    imu_features = _analyze_imu(batch.imu_readings, distance_km)

    record = TripMetrics(
        trip_id=batch.trip_id,
        vehicle_id=batch.vehicle_id,
        driver_id=batch.driver_id,
        start_timestamp=batch.start_timestamp,
        stored_at=datetime.now(timezone.utc).isoformat(),
        duration_minutes=duration_minutes,
        distance_km=distance_km,
        total_mileage_km=distance_km,
        **obd_features,
        **imu_features,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

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
