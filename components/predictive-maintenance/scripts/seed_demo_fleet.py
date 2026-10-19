"""Give one account a fleet of demo vehicles, each with a different story.

    python -m scripts.seed_demo_fleet --email someone@example.com
    python -m scripts.seed_demo_fleet --email someone@example.com --dry-run

WHAT IT BUILDS. Six vehicles, each written to the app's `public.vehicles` table
for that account and given a driving history in this service:

    CAR-4127  Toyota Axio      everything healthy; an old fuel-cap code, since cleared
    CAD-8834  Toyota Premio    overheating (P0217), engine wear Poor
    CAF-2290  Suzuki Wagon R   cylinder 2 misfire that came back after being
                               cleared (P0302), catalyst code now pending (P0420)
    CAH-5561  Nissan X-Trail   charging fault (P0562), engine fine, battery Poor
    PH-6612   Toyota Hilux     ABS wheel speed sensor (C0035), pads and tyres worn
    CAK-3409  Honda Fit        running lean (P0171) plus a loose fuel cap (P0457)

NOTHING HERE WRITES A HEALTH NUMBER. Every trip goes through the real
`process_trip`, so the features, the RUL models and the fault bookkeeping
(times seen, recurrences, freeze frames, resolution on a clean read) are the
same code path a phone upload takes. The scenarios only choose the sensor
readings a car with that fault would produce; the models decide what that
means. That keeps the demo honest: if the models change, the health shown
changes with them.

Re-running is safe. The service-side rows for these plates are deleted and
rebuilt, and the vehicle rows are updated in place, so the app keeps the same
vehicle ids. A plate that already belongs to a DIFFERENT account is refused
rather than taken over.
"""
from __future__ import annotations

import argparse
import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import text  # noqa: E402

from app.controllers import fault_controller  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    ComponentHealthFloor,
    DTCEvent,
    ServiceRecord,
    TripMetrics,
    VehicleBaseline,
)
from app.routes.ingest import process_trip  # noqa: E402
from app.schemas import TripBatch  # noqa: E402

# Marks rows this script wrote, so they can be told apart from real ones.
SEED_TAG = "demo-seed"

# History spans the six weeks before today.
HISTORY_DAYS = 42


@dataclass
class Fault:
    code: str
    # Trip indices (0-based, inclusive) on which the ECU reported the code.
    trips: List[int]
    status: str = "confirmed"
    # Mode 02 snapshot stored with the first sighting.
    freeze_frame: Optional[Dict[str, float]] = None
    # Per-trip status override, e.g. pending before it confirms.
    status_by_trip: Dict[int, str] = field(default_factory=dict)


@dataclass
class Service:
    component: str          # engine | brake | tire | battery
    service_type: str       # replacement | oil_change | inspection | ...
    odometer_km: float
    item_name: Optional[str] = None
    garage_name: Optional[str] = None
    cost_lkr: Optional[float] = None
    notes: Optional[str] = None
    # For work done during the recorded history: the trip it followed. The
    # odometer is then taken from the trips instead of odometer_km.
    after_trip: Optional[int] = None


@dataclass
class Scenario:
    plate: str
    make: str
    model: str
    year: int
    color: str
    fuel: str
    nickname: str
    odometer_km: float            # what the dash reads after the last trip
    trips: int
    # Engine: per-trip peak coolant ramps start -> end across the history.
    coolant_peak: Tuple[float, float]
    ltft_mean: float
    ltft_std: float
    rpm: float
    # Charging: running voltage ramps start -> end; min is the deepest dip.
    volt_run: Tuple[float, float]
    volt_std: float
    volt_min: Tuple[float, float]
    iat: float
    speed: float
    # Behaviour, as the phone's 4 Hz analysis would report it.
    brake_per_km: float
    decel: float
    corner_per_km: float
    services: List[Service] = field(default_factory=list)
    faults: List[Fault] = field(default_factory=list)
    is_default: bool = False


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


SCENARIOS: List[Scenario] = [
    # ── Healthy: the control. Everything in range and a code read that came
    # back clean, so the app can say "checked, nothing found" rather than
    # "not checked".
    Scenario(
        plate="CAR-4127", make="Toyota", model="Axio", year=2018, color="White",
        fuel="petrol", nickname="Daily Axio", odometer_km=72_000, trips=22,
        coolant_peak=(89, 91), ltft_mean=1.0, ltft_std=1.8, rpm=2050,
        volt_run=(14.1, 14.1), volt_std=0.08, volt_min=(13.3, 13.25), iat=29,
        speed=42, brake_per_km=0.12, decel=2.9, corner_per_km=0.12,
        services=[
            Service("battery", "replacement", 58_000, "Amaron 55B24L", "Nawala Auto Electricals", 32_500),
            Service("tire", "replacement", 64_000, "Bridgestone Ecopia 185/65 R15 x4", "Rajagiriya Tyre & Brake", 88_000),
            Service("brake", "replacement", 64_500, "Front brake pads (Toyota genuine)", "Maharagama Auto Service", 14_500),
            Service("engine", "oil_change", 70_500, "Toyota 0W-20 + filter", "Maharagama Auto Service", 11_800),
        ],
        # Loose fuel cap a month ago, gone once it was tightened. Without at
        # least one stored code the app reads a clean car as "not checked yet".
        faults=[Fault("P0457", trips=[4, 5], freeze_frame={"rpm": 750.0, "speed_kmh": 0.0, "coolant_temp_c": 88.0})],
        is_default=True,
    ),
    # ── Overheating. Peak coolant creeps up over six weeks as the cooling
    # system fails, until the ECU sets P0217. Fuel trim gets ragged at the end,
    # the pattern of a head gasket starting to let coolant into a cylinder,
    # which is what drags the engine's wear figure down with it.
    Scenario(
        plate="CAD-8834", make="Toyota", model="Premio", year=2013, color="Silver",
        fuel="petrol", nickname="Family Premio", odometer_km=128_400, trips=20,
        coolant_peak=(103, 121), ltft_mean=3.0, ltft_std=5.4, rpm=2350,
        volt_run=(14.0, 13.9), volt_std=0.13, volt_min=(13.1, 13.0), iat=37,
        speed=38, brake_per_km=0.17, decel=2.6, corner_per_km=0.15,
        services=[
            Service("battery", "replacement", 100_000, "Exide 65D23L", "Borella Quick Service", 36_000),
            Service("tire", "replacement", 112_000, "Dunlop SP Touring 195/65 R15 x4", "Rajagiriya Tyre & Brake", 92_000),
            Service("brake", "replacement", 108_500, "Front brake pads", "Malabe Motor Works", 12_000),
            Service("engine", "oil_change", 125_200, "Castrol Magnatec 10W-30 + filter", "Malabe Motor Works", 12_500),
            Service("engine", "inspection", 0, None, "Malabe Motor Works", 2_500,
                    "Coolant topped up, no external leak found. Advised to monitor temperature gauge.",
                    after_trip=14),
        ],
        faults=[
            Fault("P0217", trips=list(range(13, 20)), freeze_frame={
                "coolant_temp_c": 121.0, "rpm": 2640.0, "speed_kmh": 34.0,
                "engine_load_percent": 71.0, "intake_air_temp_c": 44.0,
                "battery_voltage_v": 14.0, "ltft_percent": 6.3,
            }),
        ],
    ),
    # ── Misfire that came back. P0302 is read for a week, a garage replaces
    # the plugs and clears the light, and it returns: the coil was the fault.
    # Left alone long enough, the catalyst starts to suffer, so P0420 shows up
    # as pending on the last trips.
    Scenario(
        plate="CAF-2290", make="Suzuki", model="Wagon R", year=2017, color="Blue",
        fuel="petrol", nickname="Wagon R", odometer_km=72_300, trips=22,
        coolant_peak=(92, 94), ltft_mean=6.0, ltft_std=5.6, rpm=2300,
        volt_run=(14.1, 14.0), volt_std=0.10, volt_min=(13.2, 13.2), iat=30,
        speed=36, brake_per_km=0.15, decel=2.7, corner_per_km=0.14,
        services=[
            Service("battery", "replacement", 62_000, "Amaron 38B20L", "Battaramulla Car Care", 24_000),
            Service("tire", "replacement", 52_000, "Yokohama BluEarth 155/65 R14 x4", "Kottawa Vehicle Care", 54_000),
            Service("brake", "replacement", 57_000, "Front brake pads", "Kottawa Vehicle Care", 8_500),
            Service("engine", "oil_change", 69_800, "Suzuki Ecstar 0W-20 + filter", "Battaramulla Car Care", 8_900),
            Service("engine", "service", 0, "NGK spark plugs x3", "Battaramulla Car Care", 7_200,
                    "Rough idle. Spark plugs replaced and fault code P0302 cleared.",
                    after_trip=11),
        ],
        faults=[
            Fault("P0302", trips=list(range(5, 12)) + list(range(15, 22)), freeze_frame={
                "rpm": 2380.0, "speed_kmh": 52.0, "engine_load_percent": 68.0,
                "coolant_temp_c": 91.0, "ltft_percent": 9.4, "intake_air_temp_c": 33.0,
            }),
            Fault("P0420", trips=[19, 20, 21], status="pending", freeze_frame={
                "rpm": 2150.0, "speed_kmh": 61.0, "engine_load_percent": 47.0,
                "coolant_temp_c": 92.0, "ltft_percent": 8.1,
            }),
        ],
    ),
    # ── Charging fault. The engine is in good shape; running voltage sags
    # from a healthy 14 V toward battery-only voltage as the alternator gives
    # out. Pending first, then confirmed - the order a real ECU sets it.
    Scenario(
        plate="CAH-5561", make="Nissan", model="X-Trail", year=2015, color="Black",
        fuel="petrol", nickname="X-Trail", odometer_km=96_500, trips=20,
        coolant_peak=(90, 91), ltft_mean=1.2, ltft_std=1.9, rpm=2100,
        volt_run=(13.9, 12.5), volt_std=0.42, volt_min=(13.0, 11.6), iat=31,
        speed=45, brake_per_km=0.13, decel=2.8, corner_per_km=0.13,
        services=[
            Service("battery", "replacement", 70_000, "Exide 75D23L", "DriveTech Motors", 39_500),
            Service("tire", "replacement", 80_000, "Michelin Primacy 4 225/65 R17 x4", "Rajagiriya Tyre & Brake", 168_000),
            Service("brake", "replacement", 88_000, "Front brake pads (Nissan genuine)", "Maharagama Auto Service", 19_500),
            Service("engine", "oil_change", 93_400, "Nissan 5W-30 + filter", "Maharagama Auto Service", 14_200),
        ],
        faults=[
            Fault("P0562", trips=list(range(12, 20)), status_by_trip={12: "pending", 13: "pending"},
                  freeze_frame={
                      "battery_voltage_v": 11.9, "rpm": 780.0, "speed_kmh": 0.0,
                      "coolant_temp_c": 89.0, "engine_load_percent": 31.0,
                  }),
        ],
    ),
    # ── Brakes. A hard-driven double cab: pads nearly gone, tyres worn, and
    # the left-front ABS sensor dropping out, so ABS is off on a vehicle that
    # is already short of stopping power. Diesel engine itself is healthy.
    Scenario(
        plate="PH-6612", make="Toyota", model="Hilux", year=2016, color="Grey",
        fuel="diesel", nickname="Site Hilux", odometer_km=118_000, trips=20,
        coolant_peak=(90, 91), ltft_mean=1.0, ltft_std=2.0, rpm=1850,
        volt_run=(14.0, 14.0), volt_std=0.11, volt_min=(13.2, 13.2), iat=32,
        speed=48, brake_per_km=0.30, decel=1.7, corner_per_km=0.24,
        services=[
            Service("battery", "replacement", 100_000, "Amaron 80D26L", "Maharagama Auto Service", 42_000),
            Service("tire", "replacement", 83_000, "Bridgestone Dueler A/T 265/65 R17 x4", "Rajagiriya Tyre & Brake", 196_000),
            Service("brake", "replacement", 82_000, "Front brake pads", "Kottawa Vehicle Care", 16_000),
            Service("engine", "oil_change", 114_800, "Toyota 15W-40 diesel + filter", "Kottawa Vehicle Care", 16_800),
        ],
        faults=[
            Fault("C0035", trips=list(range(15, 20)), freeze_frame={
                "speed_kmh": 64.0, "rpm": 1850.0, "engine_load_percent": 42.0,
                "coolant_temp_c": 90.0, "battery_voltage_v": 14.0,
            }),
        ],
    ),
    # ── Lean mixture, with a nuisance code alongside it. Fuel trim sits well
    # positive (the ECU adding fuel to make up for unmetered air) and P0171
    # sets; a fuel cap left loose at the last fill-up adds P0457 - correctly a
    # "monitor", which shows the app does not shout about everything.
    Scenario(
        plate="CAK-3409", make="Honda", model="Fit", year=2015, color="Red",
        fuel="petrol", nickname="Honda Fit", odometer_km=61_000, trips=20,
        coolant_peak=(91, 92), ltft_mean=13.0, ltft_std=4.0, rpm=2100,
        volt_run=(14.1, 14.1), volt_std=0.10, volt_min=(13.25, 13.25), iat=30,
        speed=40, brake_per_km=0.13, decel=2.8, corner_per_km=0.14,
        services=[
            Service("battery", "replacement", 48_000, "Amaron 44B19L", "Nawala Auto Electricals", 26_500),
            Service("tire", "replacement", 40_000, "Yokohama BluEarth 175/65 R15 x4", "Rajagiriya Tyre & Brake", 72_000),
            Service("brake", "replacement", 44_000, "Front brake pads (Honda genuine)", "Metro Auto Hub", 11_000),
            Service("engine", "oil_change", 58_900, "Honda 0W-20 + filter", "Metro Auto Hub", 10_400),
        ],
        faults=[
            Fault("P0171", trips=list(range(12, 20)), freeze_frame={
                "rpm": 820.0, "speed_kmh": 0.0, "engine_load_percent": 24.0,
                "coolant_temp_c": 90.0, "ltft_percent": 21.9, "intake_air_temp_c": 34.0,
            }),
            Fault("P0457", trips=[18, 19], freeze_frame={
                "rpm": 760.0, "speed_kmh": 0.0, "coolant_temp_c": 88.0,
            }),
        ],
    ),
]


# ---------------------------------------------------------------------------
# Trip synthesis
# ---------------------------------------------------------------------------

def _clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _trip_batch(s: Scenario, i: int, start: datetime, user_id: str, rng: random.Random) -> dict:
    """One trip's raw readings, shaped like the phone sends them."""
    t = i / max(s.trips - 1, 1)
    minutes = rng.randint(28, 62)
    n = minutes  # one OBD reading a minute

    peak = _lerp(*s.coolant_peak, t) + rng.gauss(0, 0.8)
    run_v = _lerp(*s.volt_run, t)
    min_v = _lerp(*s.volt_min, t)

    obd = []
    for k in range(n):
        warm = min(1.0, k / 8)  # cold start: coolant climbs over ~8 minutes
        rpm = _clip(rng.gauss(s.rpm, 220), 700, 4200)
        speed = _clip(rng.gauss(s.speed, 12), 0, 110)
        load = _clip(rng.gauss(45, 12), 10, 95)
        obd.append({
            "timestamp_offset_sec": k * 60,
            "rpm": round(rpm, 1),
            "speed_kmh": round(speed, 1),
            "coolant_temp_c": round(_clip(_lerp(55, peak - 1.5, warm) + rng.gauss(0, 0.6), 20, peak), 1),
            "battery_voltage_v": round(_clip(rng.gauss(run_v, s.volt_std), min_v, 15.0), 3),
            "ltft_percent": round(_clip(rng.gauss(s.ltft_mean, s.ltft_std), -25, 25), 2),
            "throttle_percent": round(_clip(load * 0.8 + rng.gauss(0, 4), 0, 100), 1),
            "engine_load_percent": round(load, 1),
            "intake_air_temp_c": round(_clip(rng.gauss(s.iat, 2.5), 10, 70), 1),
        })
    # Pin the extremes the features are built from, so the per-trip peak and
    # dip are the scenario's, not whatever the noise happened to reach.
    obd[-max(2, n // 4)]["coolant_temp_c"] = round(peak, 1)
    obd[rng.randint(1, n - 2)]["battery_voltage_v"] = round(min_v, 3)

    imu = [
        {
            "timestamp_offset_sec": k * 120,
            "accel_x": round(rng.gauss(0, 0.3), 4), "accel_y": round(rng.gauss(0, 0.5), 4),
            "accel_z": round(rng.gauss(-0.1, 0.4), 4), "gyro_x": round(rng.gauss(0, 0.05), 4),
            "gyro_y": round(rng.gauss(0, 0.05), 4), "gyro_z": round(rng.gauss(0, 0.1), 4),
        }
        for k in range(minutes * 60 // 120 + 1)
    ]

    est_km = s.speed * minutes / 60
    behavior = {
        "harsh_braking_events": max(0, round(rng.gauss(s.brake_per_km * est_km, 0.8))),
        "avg_decel_intensity": round(_clip(rng.gauss(s.decel, 0.15), 0.5, 8), 2),
        "harsh_cornering_events": max(0, round(rng.gauss(s.corner_per_km * est_km, 0.8))),
        "harsh_accel_events": max(0, round(rng.gauss(0.06 * est_km, 0.6))),
        "avg_accel_intensity": round(_clip(rng.gauss(2.2, 0.2), 0.5, 8), 2),
        "longitudinal_jerk_rms": round(_clip(rng.gauss(0.75, 0.1), 0.1, 3), 3),
        "steering_reversal_rate": round(_clip(rng.gauss(10, 1.5), 0, 40), 2),
        "steering_smoothness_index": round(_clip(rng.gauss(0.1, 0.02), 0, 1), 3),
        "swerve_events": 0,
        "imu_sample_count": minutes * 60 * 4,
        "mount_stable": True,
        "axis_confidence": 0.92,
    }

    dtcs, frames = [], {}
    for f in s.faults:
        if i in f.trips:
            dtcs.append({"code": f.code, "status": f.status_by_trip.get(i, f.status)})
            if f.freeze_frame and i == f.trips[0]:
                frames[f.code] = f.freeze_frame

    return {
        "trip_id": str(uuid.uuid4()),
        "vehicle_id": s.plate,
        "driver_id": user_id,
        "start_timestamp": start.isoformat(),
        "end_timestamp": (start + timedelta(minutes=minutes - 1)).isoformat(),
        "client_schema_version": 2,
        "obd_readings": obd,
        "imu_readings": imu,
        "behavior": behavior,
        "dtcs": dtcs,
        # Every trip completed a code read, so a code missing from a trip is
        # resolved - which is how the Wagon R's "cleared at the garage" gap
        # registers as a real clear-and-return.
        "dtc_read_ok": True,
        "freeze_frames": frames,
    }


def _trip_starts(s: Scenario, now: datetime, rng: random.Random) -> List[datetime]:
    """Trip start times spread across the history, oldest first, in commuting hours."""
    first_day = now - timedelta(days=HISTORY_DAYS)
    starts = []
    for i in range(s.trips):
        day = first_day + timedelta(days=round(i * (HISTORY_DAYS - 1) / max(s.trips - 1, 1)))
        hour_lk = rng.choice([7, 8, 17, 18])  # Sri Lanka time, UTC+5:30
        local = day.replace(hour=hour_lk, minute=rng.randint(0, 50), second=0, microsecond=0)
        starts.append(local - timedelta(hours=5, minutes=30))
    return starts


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _user_id(db, email: str) -> str:
    row = db.execute(
        text("select id from auth.users where lower(email) = lower(:e)"), {"e": email}
    ).first()
    if row is None:
        raise SystemExit(f"No Supabase account for {email}.")
    return str(row[0])


def _check_plates_free(db, user_id: str) -> None:
    plates = [s.plate for s in SCENARIOS]
    taken = db.execute(
        text("select plate_number, user_id from public.vehicles "
             "where plate_number = any(:p) and user_id <> cast(:u as uuid)"),
        {"p": plates, "u": user_id},
    ).fetchall()
    if taken:
        raise SystemExit(
            "Refusing: these plates belong to another account: "
            + ", ".join(r[0] for r in taken)
        )


def _purge_service_side(db, plate: str) -> None:
    for model in (TripMetrics, DTCEvent, ServiceRecord, VehicleBaseline, ComponentHealthFloor):
        db.query(model).filter(model.vehicle_id == plate).delete()
    db.commit()


def _upsert_vehicle(db, user_id: str, s: Scenario) -> None:
    params = {
        "u": user_id, "nick": s.nickname, "make": s.make, "model": s.model,
        "year": s.year, "plate": s.plate, "color": s.color,
        "km": int(round(s.odometer_km)), "fuel": s.fuel, "def": s.is_default,
    }
    updated = db.execute(
        text("update public.vehicles set nickname=:nick, make=:make, model=:model, year=:year, "
             "color=:color, current_mileage=:km, fuel_type=:fuel, is_default=:def "
             "where user_id = cast(:u as uuid) and plate_number = :plate"),
        params,
    ).rowcount
    if not updated:
        db.execute(
            text("insert into public.vehicles "
                 "(user_id, nickname, make, model, year, plate_number, color, current_mileage, fuel_type, is_default) "
                 "values (cast(:u as uuid), :nick, :make, :model, :year, :plate, :color, :km, :fuel, :def)"),
            params,
        )
    if s.is_default:
        # One default per account, as clearOtherDefaults keeps it in the app.
        db.execute(
            text("update public.vehicles set is_default = false "
                 "where user_id = cast(:u as uuid) and plate_number <> :plate"),
            {"u": user_id, "plate": s.plate},
        )
    db.commit()


def _seed_vehicle(db, user_id: str, s: Scenario, now: datetime, rng: random.Random) -> None:
    _purge_service_side(db, s.plate)
    _upsert_vehicle(db, user_id, s)

    starts = _trip_starts(s, now, rng)
    trip_km: List[float] = []  # cumulative distance after each trip
    original_now = fault_controller._now
    try:
        for i, start in enumerate(starts):
            # Stamp fault sightings with the trip's own time, so "first seen
            # 9 days ago" means what it says.
            fault_controller._now = lambda ts=start.isoformat(): ts
            result = process_trip(TripBatch.model_validate(_trip_batch(s, i, start, user_id, rng)), db)
            trip_km.append((trip_km[-1] if trip_km else 0.0) + result.distance_km)
    finally:
        fault_controller._now = original_now

    total_trip_km = trip_km[-1]
    baseline_km = s.odometer_km - total_trip_km
    registered = starts[0] - timedelta(days=1)
    db.add(VehicleBaseline(
        vehicle_id=s.plate, owner_id=user_id, condition="used",
        baseline_odometer_km=baseline_km, trip_km_at_baseline=0.0,
        recorded_at=registered.isoformat(), updated_at=registered.isoformat(),
    ))

    for svc in s.services:
        # Date the record from where the odometer stood at that point: before
        # the app's history, extrapolate at the car's recent pace.
        if svc.after_trip is not None:
            odometer = baseline_km + trip_km[svc.after_trip]
            when = starts[svc.after_trip] + timedelta(hours=10)
        else:
            odometer = float(svc.odometer_km)
            km_per_day = total_trip_km / HISTORY_DAYS
            when = starts[0] - timedelta(days=(baseline_km - odometer) / max(km_per_day, 1))
        db.add(ServiceRecord(
            id=str(uuid.uuid4()), vehicle_id=s.plate, logged_by=SEED_TAG,
            component=svc.component, service_type=svc.service_type,
            service_date=when.date().isoformat(), created_at=when.isoformat(),
            km_on_component=0.0, odometer_km_at_service=round(odometer, 1),
            install_km=round(odometer, 1), basis="user", expected_life_km_at_estimate=None,
            item_name=svc.item_name,
            is_original="original" if svc.service_type == "replacement" else None,
            garage_name=svc.garage_name, cost_lkr=svc.cost_lkr, notes=svc.notes,
        ))
    db.commit()

    live = db.query(DTCEvent).filter(DTCEvent.vehicle_id == s.plate, DTCEvent.resolved_at.is_(None)).all()
    print(f"  {s.plate:9s} {s.make} {s.model}: {len(starts)} trips, {total_trip_km:,.0f} km recorded, "
          f"odometer {s.odometer_km:,.0f} km, live codes: "
          + (", ".join(f"{r.code}({r.status}, x{r.times_seen}, back {r.recurrences}x)" for r in live) or "none"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", required=True)
    parser.add_argument("--seed", type=int, default=26)
    parser.add_argument("--dry-run", action="store_true", help="Check the account and plates, write nothing")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user_id = _user_id(db, args.email)
        _check_plates_free(db, user_id)
        print(f"Account {args.email} ({user_id})")
        if args.dry_run:
            print("Dry run - plates are free, nothing written.")
            return
        now = datetime.now(timezone.utc)
        for i, s in enumerate(SCENARIOS):
            _seed_vehicle(db, user_id, s, now, random.Random(args.seed * 100 + i))
    finally:
        db.close()


if __name__ == "__main__":
    main()
