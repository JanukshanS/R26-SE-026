"""
Phase 1 — Synthetic Trip Data Generator
========================================
Generates 50 realistic vehicle trip batches and writes them to
data/trip_data.json.

OBD-II readings : every 5 minutes (OBD_INTERVAL_SEC = 300)
Sensor readings : every 2 minutes from the mobile phone IMU
                  (IMU_INTERVAL_SEC = 120), with randomly injected
                  harsh-braking and sharp-cornering events.

Example — 50-minute trip:
  OBD  readings: 50 / 5  = 10
  IMU  readings: 50 / 2  = 25
"""

from __future__ import annotations

import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import numpy as np

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NUM_TRIPS = 50
OBD_INTERVAL_SEC = 300          # 5-minute OBD sampling
IMU_INTERVAL_SEC = 120          # 2-minute mobile phone sensor sampling
MIN_DURATION_MIN = 30
MAX_DURATION_MIN = 120

VEHICLES = [f"VEH-{i:03d}" for i in range(1, 6)]   # 5 vehicles
DRIVERS  = [f"DRV-{i:03d}" for i in range(1, 11)]  # 10 drivers

# At 2-min intervals a 60-min trip has 30 sensor readings.
# Probabilities tuned so ~4 braking and ~6 cornering events appear per hour.
HARSH_BRAKE_PROB   = 0.13
HARSH_CORNER_PROB  = 0.20

SEED = 42
np.random.seed(SEED)
random.seed(SEED)

# ---------------------------------------------------------------------------
# OBD generation — realistic correlations via shared engine_load
# ---------------------------------------------------------------------------

def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _generate_obd_readings(
    duration_sec: int,
    trip_mean_load: float,
) -> List[Dict[str, Any]]:
    """
    Sample one OBD record every OBD_INTERVAL_SEC seconds.
    All signals are derived from engine_load to ensure physical correlations.
    """
    n_readings = max(2, duration_sec // OBD_INTERVAL_SEC)
    readings: List[Dict[str, Any]] = []

    for idx in range(n_readings):
        # Per-reading engine load (Beta-distributed -> right-skewed, mean ≈ 40 %)
        load = float(np.random.beta(2, 3) * 100)

        rpm = _clip(800 + (load / 100) * 3200 + np.random.normal(0, 150), 600, 4500)
        throttle = _clip(5 + (load / 100) * 80 + np.random.normal(0, 5), 0, 100)
        speed = _clip(20 + (load / 100) * 80 + np.random.normal(0, 15), 0, 120)

        # Coolant: rises with sustained load + warm-up index
        coolant = _clip(
            85 + (trip_mean_load / 100) * 25 + np.random.normal(0, 3) + idx * 0.5,
            70, 120,
        )
        iat = _clip(25 + (load / 100) * 10 + np.random.normal(0, 5), 10, 60)
        # Voltage dips slightly under heavy load (alternator behaviour)
        voltage = _clip(14.2 - (load / 100) * 1.5 + np.random.normal(0, 0.2), 11.5, 14.8)
        ltft = _clip(float(np.random.normal(0, 3)), -15, 15)

        readings.append({
            "timestamp_offset_sec": idx * OBD_INTERVAL_SEC,
            "rpm":                  round(rpm, 1),
            "speed_kmh":            round(speed, 1),
            "coolant_temp_c":       round(coolant, 1),
            "battery_voltage_v":    round(voltage, 3),
            "ltft_percent":         round(ltft, 2),
            "throttle_percent":     round(throttle, 1),
            "engine_load_percent":  round(load, 1),
            "intake_air_temp_c":    round(iat, 1),
        })

    return readings


# ---------------------------------------------------------------------------
# IMU generation — baseline noise + injected harsh events
# ---------------------------------------------------------------------------

def _generate_imu_readings(duration_sec: int) -> List[Dict[str, Any]]:
    """
    One sensor snapshot every IMU_INTERVAL_SEC (2 minutes).
    For a 50-minute trip: 50 / 2 = 25 readings.
    Each reading represents the phone sensor snapshot at that moment;
    harsh events are injected at snapshot time to model sudden dynamics.
    """
    readings: List[Dict[str, Any]] = []

    for t in range(0, duration_sec, IMU_INTERVAL_SEC):
        # Baseline gentle driving dynamics
        ax = float(np.random.normal(0, 0.3))    # lateral
        ay = float(np.random.normal(0, 0.5))    # longitudinal
        az = float(np.random.normal(-0.1, 0.4)) # vertical (braking proxy)
        gx = float(np.random.normal(0, 0.05))   # roll
        gy = float(np.random.normal(0, 0.05))   # pitch
        gz = float(np.random.normal(0, 0.10))   # yaw (cornering proxy)

        # Inject hard-braking event (z-axis accel < -3.5 m/s²)
        if random.random() < HARSH_BRAKE_PROB:
            az = float(np.random.uniform(-5.5, -3.5))
            ay = float(np.random.uniform(-4.0, -2.0))   # complementary longitudinal decel

        # Inject sharp-cornering event (|gyro_z| > 0.6 rad/s)
        if random.random() < HARSH_CORNER_PROB:
            direction = random.choice([-1, 1])
            gz = direction * float(np.random.uniform(0.6, 1.2))
            ax = gz * float(np.random.uniform(1.5, 2.5))  # lateral g follows yaw

        readings.append({
            "timestamp_offset_sec": t,
            "accel_x": round(ax, 4),
            "accel_y": round(ay, 4),
            "accel_z": round(az, 4),
            "gyro_x":  round(gx, 4),
            "gyro_y":  round(gy, 4),
            "gyro_z":  round(gz, 4),
        })

    return readings


# ---------------------------------------------------------------------------
# Trip assembly
# ---------------------------------------------------------------------------

def _build_trip(
    trip_index: int,
    base_time: datetime,
) -> Dict[str, Any]:
    duration_min = random.randint(MIN_DURATION_MIN, MAX_DURATION_MIN)
    duration_sec = duration_min * 60

    vehicle_id = random.choice(VEHICLES)
    driver_id  = random.choice(DRIVERS)

    # Representative mean load for the trip (governs coolant ceiling)
    trip_mean_load = float(np.random.beta(2, 3) * 100)

    obd = _generate_obd_readings(duration_sec, trip_mean_load)
    imu = _generate_imu_readings(duration_sec)

    start_ts = (base_time + timedelta(hours=trip_index * 2)).isoformat()

    return {
        "trip_id":         str(uuid.uuid4()),
        "vehicle_id":      vehicle_id,
        "driver_id":       driver_id,
        "start_timestamp": start_ts,
        "obd_readings":    obd,
        "imu_readings":    imu,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    os.makedirs("data", exist_ok=True)
    output_path = os.path.join("data", "trip_data.json")

    base_time = datetime(2024, 1, 1, 6, 0, 0, tzinfo=timezone.utc)
    trips: List[Dict[str, Any]] = []

    total_obd = 0
    total_imu = 0
    braking_events = 0
    cornering_events = 0

    for i in range(NUM_TRIPS):
        trip = _build_trip(i, base_time)
        trips.append(trip)
        total_obd += len(trip["obd_readings"])
        total_imu += len(trip["imu_readings"])

        # Count injected events for reporting (approximation via threshold)
        az_vals = [r["accel_z"] for r in trip["imu_readings"]]
        gz_vals = [abs(r["gyro_z"]) for r in trip["imu_readings"]]
        braking_events  += sum(1 for v in az_vals if v < -3.5)
        cornering_events += sum(1 for v in gz_vals if v > 0.6)

    payload = {"trips": trips}
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print(f"Generated {NUM_TRIPS} trips  ->  {output_path}")
    print(f"  OBD readings  : {total_obd:,}  ({total_obd / NUM_TRIPS:.1f} avg per trip)")
    print(f"  IMU readings  : {total_imu:,}  ({total_imu / NUM_TRIPS:.0f} avg per trip)")
    print(f"  Harsh braking : {braking_events:,} events injected")
    print(f"  Sharp cornering: {cornering_events:,} events injected")
    print(f"  File size     : {os.path.getsize(output_path) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
