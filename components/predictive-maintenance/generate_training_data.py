"""
Comprehensive RUL Training Dataset Generator
=============================================
Combines OBD-II features, mobile IMU features, and simulated past service
records to produce a ground-truth supervised dataset for RUL prediction.

How RUL labels are computed
----------------------------
Each vehicle has a service record: the odometer readings at which each
component (engine, brake pads, tires, battery) was replaced.  For a trip
at cumulative mileage X km, the RUL is simply:

    RUL = next_replacement_km_after_X  −  X

This mimics exactly what a real workshop system would give you when you
query "how many km left on this brake pad?"

Degradation signal
------------------
Features are not static — they worsen as a component ages:
  • Engine:  coolant temperature rises, LTFT instability increases
  • Brakes:  deceleration intensity falls (pads lose bite)
  • Tires:   cornering events increase (less grip → more slides detected)
  • Battery: voltage_std rises, minimum voltage drops

This means the ML model learns real physics, not just a formula.

Output
------
  data/service_records.json      — full maintenance history per vehicle
  data/rul_training_dataset.csv  — flat feature + label matrix (one row per trip)
"""

from __future__ import annotations

import json
import os
import random
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Random seed
# ---------------------------------------------------------------------------
SEED = 42
np.random.seed(SEED)
random.seed(SEED)

# ---------------------------------------------------------------------------
# Fleet configuration
# ---------------------------------------------------------------------------
VEHICLES: List[Tuple[str, str]] = [
    # (vehicle_id, driving_profile)
    ("VEH-A01", "aggressive"),
    ("VEH-A02", "aggressive"),
    ("VEH-A03", "aggressive"),
    ("VEH-A04", "aggressive"),
    ("VEH-A05", "aggressive"),
    ("VEH-M01", "moderate"),
    ("VEH-M02", "moderate"),
    ("VEH-M03", "moderate"),
    ("VEH-G01", "gentle"),
    ("VEH-G02", "gentle"),
]

SIMULATED_KM_PER_VEHICLE = 150_000   # full lifetime to simulate
AVG_TRIP_KM = 30                     # mean trip distance
TRIP_KM_STD = 18                     # trip distance variance

# ---------------------------------------------------------------------------
# Driving profile parameters
# (base values for each OBD/IMU feature before degradation is applied)
# ---------------------------------------------------------------------------
PROFILES: Dict[str, Dict[str, float]] = {
    "aggressive": {
        "base_rpm":      2800,   # higher revving
        "base_coolant":   96,    # already warm
        "base_ltft_std":   2.5,
        "base_speed":      72,
        "base_braking":   0.45,  # events per km
        "base_decel":      4.3,  # m/s²
        "base_cornering": 0.38,  # events per km
        "base_voltage_std": 0.18,
        "base_min_voltage": 12.85,
        "base_iat":        34,
    },
    "moderate": {
        "base_rpm":      2100,
        "base_coolant":   88,
        "base_ltft_std":   1.8,
        "base_speed":      55,
        "base_braking":   0.20,
        "base_decel":      3.0,
        "base_cornering": 0.18,
        "base_voltage_std": 0.12,
        "base_min_voltage": 13.10,
        "base_iat":        30,
    },
    "gentle": {
        "base_rpm":      1600,
        "base_coolant":   82,
        "base_ltft_std":   1.2,
        "base_speed":      44,
        "base_braking":   0.10,
        "base_decel":      2.2,
        "base_cornering": 0.10,
        "base_voltage_std": 0.08,
        "base_min_voltage": 13.30,
        "base_iat":        27,
    },
}

# ---------------------------------------------------------------------------
# Component lifetime ranges (km) by driving profile
# Aggressive driver → shorter component life
# ---------------------------------------------------------------------------
COMPONENT_LIFETIMES: Dict[str, Dict[str, Tuple[int, int]]] = {
    "aggressive": {
        "engine":  (90_000,  130_000),
        "brake":   (18_000,   28_000),
        "tire":    (22_000,   32_000),
        "battery": (45_000,   65_000),
    },
    "moderate": {
        "engine":  (140_000, 180_000),
        "brake":   (32_000,   48_000),
        "tire":    (38_000,   52_000),
        "battery": (65_000,   90_000),
    },
    "gentle": {
        "engine":  (170_000, 220_000),
        "brake":   (48_000,   68_000),
        "tire":    (52_000,   72_000),
        "battery": (85_000,  120_000),
    },
}

COMPONENTS = ["engine", "brake", "tire", "battery"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clip(v: float, lo: float, hi: float) -> float:
    return float(max(lo, min(hi, v)))


def _n(mu: float, sigma: float) -> float:
    return float(np.random.normal(mu, sigma))


# ---------------------------------------------------------------------------
# Service record generation
# ---------------------------------------------------------------------------

def generate_service_records(
    profile: str,
    total_km: int,
) -> Dict[str, List[int]]:
    """
    Return odometer readings (km) at which each component was replaced,
    starting from 0 (brand-new vehicle).

    Example:
        {"engine": [0, 152000], "brake": [0, 24000, 50000, 76000, ...]}
    """
    records: Dict[str, List[int]] = {c: [0] for c in COMPONENTS}
    lifetimes = COMPONENT_LIFETIMES[profile]

    for component in COMPONENTS:
        lo, hi = lifetimes[component]
        current = 0
        while current < total_km:
            # Add some variance: a harsh single trip or service delay shifts the interval
            life = random.randint(lo, hi)
            current += life
            records[component].append(current)

    return records


def get_rul(cumulative_km: float, replacements: List[int]) -> float:
    """
    Next scheduled replacement minus current mileage = RUL.
    Returns 0 if the vehicle is past its last known replacement.
    """
    future = [r for r in replacements if r > cumulative_km]
    if not future:
        return 0.0
    return float(min(future) - cumulative_km)


def get_health(cumulative_km: float, replacements: List[int]) -> float:
    """
    0.0 (end-of-life) → 1.0 (brand-new), derived from position in current
    replacement interval.
    """
    # Find the bracket [last_replacement, next_replacement]
    past = [r for r in replacements if r <= cumulative_km]
    future = [r for r in replacements if r > cumulative_km]
    if not past or not future:
        return 0.0
    last = max(past)
    nxt = min(future)
    interval = nxt - last
    used = cumulative_km - last
    return float(1.0 - (used / interval))


# ---------------------------------------------------------------------------
# Feature generation with degradation signal
# ---------------------------------------------------------------------------

def generate_trip_features(
    profile: str,
    engine_health: float,    # 0=worn, 1=new
    brake_health: float,
    tire_health: float,
    battery_health: float,
    trip_km: float,
    cumulative_km: float,    # vehicle odometer — used for total_mileage_km
) -> Dict[str, float]:
    """
    Generate one row of OBD-II + IMU derived features for a single trip.
    Degradation offsets are applied so that worn components produce
    detectably different sensor signatures — this is what the ML model learns.
    """
    p = PROFILES[profile]
    wear_e = 1 - engine_health    # 0=new, 1=fully worn
    wear_b = 1 - brake_health
    wear_t = 1 - tire_health
    wear_bat = 1 - battery_health

    # --- Engine features ---
    # Worn engine: higher RPM for same output, hotter, LTFT drifts
    avg_rpm = _clip(
        _n(p["base_rpm"] * (1 + wear_e * 0.12), 180),
        600, 4500,
    )
    max_coolant_temp_c = _clip(
        _n(p["base_coolant"] + wear_e * 22, 4),
        70, 130,
    )
    ltft_std = _clip(
        abs(_n(p["base_ltft_std"] + wear_e * 7, 0.8)),
        0, 15,
    )

    # --- Brake features ---
    # Worn pads: more frequent application, but less deceleration per event
    braking_frequency = _clip(
        _n(p["base_braking"] * (1 + wear_b * 0.35), 0.04),
        0, 5,
    )
    avg_deceleration_intensity = _clip(
        _n(p["base_decel"] * (0.45 + brake_health * 0.55), 0.3),
        0, 7,
    )

    # --- Tire features ---
    # Worn tires: more cornering events detected (less grip → slides easier)
    cornering_frequency = _clip(
        _n(p["base_cornering"] * (1 + wear_t * 0.28), 0.03),
        0, 3,
    )
    avg_speed_kmh = _clip(
        _n(p["base_speed"], 10),
        10, 130,
    )

    # --- Battery features ---
    # Ageing battery: higher voltage fluctuation, deeper drops under load
    voltage_std = _clip(
        _n(p["base_voltage_std"] + wear_bat * 0.55, 0.03),
        0.03, 1.2,
    )
    min_battery_voltage_v = _clip(
        _n(p["base_min_voltage"] - wear_bat * 1.4, 0.1),
        10.5, 14.8,
    )
    avg_iat_c = _clip(
        _n(p["base_iat"], 5),
        10, 65,
    )

    return {
        "avg_rpm":                    round(avg_rpm, 1),
        "max_coolant_temp_c":         round(max_coolant_temp_c, 1),
        "ltft_std":                   round(ltft_std, 3),
        "braking_frequency":          round(braking_frequency, 4),
        "avg_deceleration_intensity": round(avg_deceleration_intensity, 3),
        "cornering_frequency":        round(cornering_frequency, 4),
        "avg_speed_kmh":              round(avg_speed_kmh, 1),
        "total_mileage_km":           round(cumulative_km, 2),  # odometer reading
        "voltage_std":                round(voltage_std, 4),
        "min_battery_voltage_v":      round(min_battery_voltage_v, 3),
        "avg_iat_c":                  round(avg_iat_c, 1),
    }


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

def simulate_vehicle(
    vehicle_id: str,
    profile: str,
    total_km: int,
) -> Tuple[List[Dict[str, Any]], Dict[str, List[int]]]:
    """
    Simulate one vehicle's full driving lifetime.
    Returns (list_of_trip_rows, service_records).
    """
    service_records = generate_service_records(profile, total_km)
    rows: List[Dict[str, Any]] = []
    cumulative_km = 0.0
    trip_number = 0

    while cumulative_km < total_km:
        trip_km = _clip(_n(AVG_TRIP_KM, TRIP_KM_STD), 3, 120)
        cumulative_km += trip_km
        trip_number += 1

        # Health of each component at this trip
        engine_health  = get_health(cumulative_km, service_records["engine"])
        brake_health   = get_health(cumulative_km, service_records["brake"])
        tire_health    = get_health(cumulative_km, service_records["tire"])
        battery_health = get_health(cumulative_km, service_records["battery"])

        features = generate_trip_features(
            profile, engine_health, brake_health, tire_health, battery_health,
            trip_km, cumulative_km,
        )

        # RUL labels — ground truth from service records
        engine_rul  = get_rul(cumulative_km, service_records["engine"])
        brake_rul   = get_rul(cumulative_km, service_records["brake"])
        tire_rul    = get_rul(cumulative_km, service_records["tire"])
        battery_rul = get_rul(cumulative_km, service_records["battery"])

        row: Dict[str, Any] = {
            "vehicle_id":      vehicle_id,
            "driving_profile": profile,
            "trip_number":     trip_number,
            "cumulative_km":   round(cumulative_km, 2),
            # Health scores (0-1) — useful for analysis, not used as features
            "engine_health":   round(engine_health, 4),
            "brake_health":    round(brake_health, 4),
            "tire_health":     round(tire_health, 4),
            "battery_health":  round(battery_health, 4),
            # OBD-II + IMU features
            **features,
            # RUL labels (targets)
            "engine_rul_km":   round(engine_rul, 1),
            "brake_rul_km":    round(brake_rul, 1),
            "tire_rul_km":     round(tire_rul, 1),
            "battery_rul_km":  round(battery_rul, 1),
        }
        rows.append(row)

    return rows, service_records


def main() -> None:
    os.makedirs("data", exist_ok=True)

    all_rows: List[Dict[str, Any]] = []
    all_service_records: Dict[str, Any] = {}

    print(f"Simulating {len(VEHICLES)} vehicles over {SIMULATED_KM_PER_VEHICLE:,} km each...\n")

    for vehicle_id, profile in VEHICLES:
        rows, records = simulate_vehicle(vehicle_id, profile, SIMULATED_KM_PER_VEHICLE)
        all_rows.extend(rows)
        all_service_records[vehicle_id] = {
            "profile": profile,
            "service_records": records,
        }
        print(
            f"  {vehicle_id} ({profile:>10})  "
            f"{len(rows):>5} trips  "
            f"engine replacements: {len(records['engine'])-1}  "
            f"brake replacements: {len(records['brake'])-1}"
        )

    # --- Save service records ---
    svc_path = os.path.join("data", "service_records.json")
    with open(svc_path, "w", encoding="utf-8") as fh:
        json.dump(all_service_records, fh, indent=2)

    # --- Save training dataset as CSV ---
    df = pd.DataFrame(all_rows)
    csv_path = os.path.join("data", "rul_training_dataset.csv")
    df.to_csv(csv_path, index=False)

    print(f"\nTotal trips generated : {len(all_rows):,}")
    print(f"Dataset shape         : {df.shape}")
    print(f"\nRUL label statistics:")
    for col in ["engine_rul_km", "brake_rul_km", "tire_rul_km", "battery_rul_km"]:
        print(
            f"  {col:<22} mean={df[col].mean():>8,.0f} km  "
            f"min={df[col].min():>6,.0f}  max={df[col].max():>8,.0f}"
        )
    print(f"\nDriving profile distribution:")
    print(df["driving_profile"].value_counts().to_string())
    print(f"\nSaved:")
    print(f"  {csv_path}")
    print(f"  {svc_path}")


if __name__ == "__main__":
    main()
