"""
Seed trip data for a specific vehicle by posting directly to the /process-trip endpoint.

Usage:
    python seed_vehicle.py                        # seeds CBD-3742
    python seed_vehicle.py --vehicle MY-PLATE     # seeds a custom plate
    python seed_vehicle.py --trips 30             # number of trips (default 20)
    python seed_vehicle.py --url http://localhost:5000
"""
from __future__ import annotations

import argparse
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import urllib.request
import urllib.error
import numpy as np

# --------------- helpers -------------------------------------------------------

def _clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _obd(duration_sec: int) -> List[Dict[str, Any]]:
    n = max(2, duration_sec // 300)
    trip_load = float(np.random.beta(2, 3) * 100)
    rows = []
    for i in range(n):
        load = float(np.random.beta(2, 3) * 100)
        rows.append({
            "timestamp_offset_sec": i * 300,
            "rpm":                 round(_clip(800 + load / 100 * 3200 + np.random.normal(0, 150), 600, 4500), 1),
            "speed_kmh":           round(_clip(20 + load / 100 * 80 + np.random.normal(0, 15), 0, 130), 1),
            "coolant_temp_c":      round(_clip(85 + trip_load / 100 * 25 + np.random.normal(0, 3) + i * 0.4, 70, 120), 1),
            "battery_voltage_v":   round(_clip(14.2 - load / 100 * 1.5 + np.random.normal(0, 0.2), 11.5, 14.8), 3),
            "ltft_percent":        round(_clip(float(np.random.normal(0, 3)), -15, 15), 2),
            "throttle_percent":    round(_clip(5 + load / 100 * 80 + np.random.normal(0, 5), 0, 100), 1),
            "engine_load_percent": round(load, 1),
            "intake_air_temp_c":   round(_clip(25 + load / 100 * 10 + np.random.normal(0, 5), 10, 60), 1),
        })
    return rows


def _imu(duration_sec: int) -> List[Dict[str, Any]]:
    rows = []
    for t in range(0, duration_sec, 120):
        ax = float(np.random.normal(0, 0.3))
        ay = float(np.random.normal(0, 0.5))
        az = float(np.random.normal(-0.1, 0.4))
        gz = float(np.random.normal(0, 0.10))

        if random.random() < 0.13:   # harsh brake
            az = float(np.random.uniform(-5.5, -3.5))
        if random.random() < 0.20:   # sharp corner
            gz = random.choice([-1, 1]) * float(np.random.uniform(0.6, 1.2))
            ax = gz * float(np.random.uniform(1.5, 2.5))

        rows.append({
            "timestamp_offset_sec": t,
            "accel_x": round(ax, 4), "accel_y": round(ay, 4), "accel_z": round(az, 4),
            "gyro_x":  round(float(np.random.normal(0, 0.05)), 4),
            "gyro_y":  round(float(np.random.normal(0, 0.05)), 4),
            "gyro_z":  round(gz, 4),
        })
    return rows


def _build_trip(vehicle_id: str, driver_id: str, start: datetime, idx: int) -> Dict[str, Any]:
    duration_min = random.randint(25, 110)
    duration_sec = duration_min * 60
    ts = (start + timedelta(hours=idx * 18 + random.randint(0, 6))).isoformat()
    return {
        "trip_id":         str(uuid.uuid4()),
        "vehicle_id":      vehicle_id,
        "driver_id":       driver_id,
        "start_timestamp": ts,
        "obd_readings":    _obd(duration_sec),
        "imu_readings":    _imu(duration_sec),
    }


def post_json(url: str, payload: Dict) -> Dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


# --------------- main ----------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vehicle", default="CBD-3742")
    parser.add_argument("--driver",  default="DRV-001")
    parser.add_argument("--trips",   type=int, default=20)
    parser.add_argument("--url",     default="http://localhost:5000")
    args = parser.parse_args()

    np.random.seed(7)
    random.seed(7)

    base = datetime(2024, 6, 1, 7, 0, 0, tzinfo=timezone.utc)
    ok = 0
    for i in range(args.trips):
        trip = _build_trip(args.vehicle, args.driver, base, i)
        try:
            result = post_json(f"{args.url}/process-trip", trip)
            print(f"  trip {i+1:02d}/{args.trips}  dist={result.get('distance_km', '?'):.1f} km  brakes={result.get('braking_events', '?')}")
            ok += 1
        except urllib.error.HTTPError as e:
            print(f"  trip {i+1:02d} FAILED  HTTP {e.code}: {e.read().decode()[:120]}")
        except Exception as e:
            print(f"  trip {i+1:02d} FAILED  {e}")

    print(f"\nDone — {ok}/{args.trips} trips ingested for vehicle '{args.vehicle}'.")
    if ok > 0:
        print(f"  GET {args.url}/vehicle/{args.vehicle}/health   <- should now return data")


if __name__ == "__main__":
    main()
