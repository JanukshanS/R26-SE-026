/**
 * Trip Recorder — OBD-II + IMU batch collection for predictive maintenance.
 *
 * OBD readings come from a real ELM327 dongle when one is connected
 * (`readRawObdPids()` — see `elm327.ble.ts`), falling back per-field to the
 * existing simulator when a PID doesn't answer or no dongle is paired.
 * IMU readings use real phone sensors (Accelerometer + Gyroscope) sampled
 * at 4 Hz; a snapshot is stored every 2 minutes, capturing the peak
 * braking/cornering intensity in that window so the backend's peak-finder
 * can detect harsh events.
 *
 * In __DEV__ mode intervals are compressed (30 s OBD / 10 s IMU) so you
 * can test a full trip in under a minute. The timestamp_offset_sec values
 * in the batch always use real-spec steps (300 / 120) so the backend
 * processes them identically.
 */

import { Platform } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { getPairing, readRawObdPids } from "./elm327";
import type { IMUReading, OBDReading, TripBatch } from "./maintenanceApi";

// Sensors are only available on native (iOS/Android). On web we fall back to
// synthetic IMU data derived from the OBD state so the UI still works.
const SENSORS_AVAILABLE = Platform.OS !== "web";

// ── Interval config ───────────────────────────────────────────────────────────
// Dev: 30 s OBD, 10 s IMU — fast enough to record a usable demo trip in ~60 s
// Prod: 5 min OBD, 2 min IMU — matches the backend spec
const IS_DEV = __DEV__;
export const OBD_INTERVAL_MS  = IS_DEV ? 30_000  : 300_000;
export const IMU_INTERVAL_MS  = IS_DEV ? 10_000  : 120_000;
const OBD_OFFSET_STEP         = 300;   // seconds — always 5-min steps in batch
const IMU_OFFSET_STEP         = 120;   // seconds — always 2-min steps in batch

// Backend requires at least 2 OBD + 5 IMU readings
export const MIN_OBD_READINGS = 2;
export const MIN_IMU_READINGS = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TripStats {
  elapsedMs: number;
  obdCount: number;
  imuCount: number;
  nextObdInMs: number;
  lastObd: OBDReading | null;
  brakingEvents: number;
  corneringEvents: number;
  canEnd: boolean;        // true when min readings reached
}

interface ActiveTrip {
  tripId: string;
  vehicleId: string;
  driverId: string;
  startTimestamp: string;
  startedAt: number;
  obdReadings: OBDReading[];
  imuReadings: IMUReading[];
  // live sensor values (updated at 4 Hz)
  latestAccel: { x: number; y: number; z: number };
  latestGyro:  { x: number; y: number; z: number };
  // worst-case peaks in the current 2-min IMU window
  windowPeakBrakingMs2: number;   // most negative accel_y × 9.81 (m/s²)
  windowPeakCorneringRad: number; // largest |gyro_z| (rad/s)
  // event tallies for the UI
  brakingEvents: number;
  corneringEvents: number;
  lastObdAt: number;
}

// ── Module-global state ───────────────────────────────────────────────────────

let trip: ActiveTrip | null = null;
let obdTimer:  ReturnType<typeof setInterval> | null = null;
let imuTimer:  ReturnType<typeof setInterval> | null = null;
let accelSub:  { remove(): void } | null = null;
let gyroSub:   { remove(): void } | null = null;
const listeners: Set<() => void> = new Set();

// ── Public API ────────────────────────────────────────────────────────────────

export function isTripActive(): boolean { return trip !== null; }

export function getTripStats(): TripStats | null {
  if (!trip) return null;
  const now      = Date.now();
  const elapsed  = now - trip.lastObdAt;
  const nextObdInMs = Math.max(0, OBD_INTERVAL_MS - (elapsed % OBD_INTERVAL_MS));
  return {
    elapsedMs:     now - trip.startedAt,
    obdCount:      trip.obdReadings.length,
    imuCount:      trip.imuReadings.length,
    nextObdInMs,
    lastObd:       trip.obdReadings[trip.obdReadings.length - 1] ?? null,
    brakingEvents: trip.brakingEvents,
    corneringEvents: trip.corneringEvents,
    canEnd:        trip.obdReadings.length >= MIN_OBD_READINGS &&
                   trip.imuReadings.length >= MIN_IMU_READINGS,
  };
}

/** Subscribe to trip updates (new OBD/IMU reading). Returns unsubscribe fn. */
export function onTripUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function startTrip(vehicleId: string, driverId: string): string {
  if (trip) throw new Error("Trip already active — call endTrip() first.");

  const now = Date.now();
  trip = {
    tripId:           generateUuid(),
    vehicleId,
    driverId,
    startTimestamp:   new Date(now).toISOString(),
    startedAt:        now,
    obdReadings:      [],
    imuReadings:      [],
    latestAccel:      { x: 0, y: 0, z: 0 },
    latestGyro:       { x: 0, y: 0, z: 0 },
    windowPeakBrakingMs2:    0,
    windowPeakCorneringRad:  0,
    brakingEvents:    0,
    corneringEvents:  0,
    lastObdAt:        now,
  };

  // Real phone sensors at 4 Hz (native only — web uses synthetic IMU)
  if (SENSORS_AVAILABLE) {
    Accelerometer.setUpdateInterval(250);
    accelSub = Accelerometer.addListener(({ x, y, z }) => {
      if (!trip) return;
      // Convert g → m/s²; phone y-axis = forward/back when portrait on dash
      const ay = y * 9.81;
      trip.latestAccel = { x: x * 9.81, y: ay, z: z * 9.81 };
      // Track harshest braking in this window (forward decel → negative y)
      if (ay < trip.windowPeakBrakingMs2) trip.windowPeakBrakingMs2 = ay;
    });

    Gyroscope.setUpdateInterval(250);
    gyroSub = Gyroscope.addListener(({ x, y, z }) => {
      if (!trip) return;
      trip.latestGyro = { x, y, z };
      if (Math.abs(z) > Math.abs(trip.windowPeakCorneringRad))
        trip.windowPeakCorneringRad = z;
    });
  }

  // First OBD snapshot immediately (fire-and-forget — a real dongle read
  // takes a moment; obdCount just updates a beat later than IMU's).
  void captureObd();

  obdTimer = setInterval(() => { void captureObd().then(notify); }, OBD_INTERVAL_MS);
  imuTimer = setInterval(() => { captureImu(); notify(); }, IMU_INTERVAL_MS);

  return trip.tripId;
}

export async function endTrip(): Promise<TripBatch> {
  if (!trip) throw new Error("No active trip.");

  // Final snapshots
  await captureObd();
  captureImu();

  clearInterval(obdTimer!); obdTimer = null;
  clearInterval(imuTimer!); imuTimer = null;
  if (SENSORS_AVAILABLE) {
    accelSub?.remove(); accelSub = null;
    gyroSub?.remove();  gyroSub  = null;
  }

  const completed = trip;
  trip = null;

  return {
    trip_id:         completed.tripId,
    vehicle_id:      completed.vehicleId,
    driver_id:       completed.driverId,
    start_timestamp: completed.startTimestamp,
    obd_readings:    completed.obdReadings,
    imu_readings:    completed.imuReadings,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function notify() { listeners.forEach(cb => cb()); }

async function captureObd() {
  if (!trip) return;
  const idx      = trip.obdReadings.length;
  const pairing  = getPairing();
  const synthetic = synthesizeObd(idx * OBD_OFFSET_STEP, pairing?.state ?? null);

  // Real dongle first; per-field fallback to the synthesizer for whatever
  // the car didn't answer (or the whole reading, if nothing's connected).
  const real = await readRawObdPids();
  const reading: OBDReading = real
    ? {
        timestamp_offset_sec: idx * OBD_OFFSET_STEP,
        rpm:                  real.rpm                 ?? synthetic.rpm,
        speed_kmh:            real.speed_kmh            ?? synthetic.speed_kmh,
        coolant_temp_c:       real.coolant_temp_c       ?? synthetic.coolant_temp_c,
        battery_voltage_v:    real.battery_voltage_v    ?? synthetic.battery_voltage_v,
        ltft_percent:         real.ltft_percent         ?? synthetic.ltft_percent,
        throttle_percent:     real.throttle_percent     ?? synthetic.throttle_percent,
        engine_load_percent:  real.engine_load_percent  ?? synthetic.engine_load_percent,
        intake_air_temp_c:    real.intake_air_temp_c    ?? synthetic.intake_air_temp_c,
      }
    : synthetic;

  if (real) {
    const realFields = (Object.keys(real) as (keyof typeof real)[]).filter((k) => real[k] !== undefined);
    console.log(
      `[tripRecorder] OBD snapshot #${idx}: ${realFields.length}/8 fields real, rest synthetic — real=[${realFields.join(",")}]`
    );
  } else {
    console.log(`[tripRecorder] OBD snapshot #${idx}: fully synthetic (no BLE link)`);
  }

  if (!trip) return; // trip may have ended while the BLE read was in flight
  trip.obdReadings.push(reading);
  trip.lastObdAt = Date.now();
}

function captureImu() {
  if (!trip) return;
  const idx = trip.imuReadings.length;

  // On web: synthesize IMU data from the vehicle state so the backend still
  // gets realistic braking/cornering signal for the demo.
  if (!SENSORS_AVAILABLE) {
    const pairing = getPairing();
    const state   = pairing?.state ?? null;
    // Moderate city driving baseline; BRAKE_WORN state → heavier braking
    const braking   = state === "BRAKE_WORN" ? -(3.5 + Math.random() * 2.0) : -(Math.random() * 1.5);
    const cornering = (Math.random() - 0.5) * (state === "BRAKE_WORN" ? 1.2 : 0.4);
    trip.imuReadings.push({
      timestamp_offset_sec: idx * IMU_OFFSET_STEP,
      accel_x: (Math.random() - 0.5) * 0.5,
      accel_y: (Math.random() - 0.5) * 0.5,
      accel_z: braking,
      gyro_x:  (Math.random() - 0.5) * 0.1,
      gyro_y:  (Math.random() - 0.5) * 0.1,
      gyro_z:  cornering,
    });
    if (braking < -3.0)           trip.brakingEvents++;
    if (Math.abs(cornering) > 0.6) trip.corneringEvents++;
    return;
  }

  // Native: use window peak values so the backend's peak-finder can detect events.
  // braking signal goes into accel_z (backend: find_peaks(-accel_z, height=3.0))
  const reading: IMUReading = {
    timestamp_offset_sec: idx * IMU_OFFSET_STEP,
    accel_x: trip.latestAccel.x,
    accel_y: trip.latestAccel.y,
    accel_z: trip.windowPeakBrakingMs2,        // negative during hard braking
    gyro_x:  trip.latestGyro.x,
    gyro_y:  trip.latestGyro.y,
    gyro_z:  trip.windowPeakCorneringRad,       // peaks on hard corners
  };
  trip.imuReadings.push(reading);

  // Count events for the UI (same thresholds as the backend)
  if (trip.windowPeakBrakingMs2 < -3.0)               trip.brakingEvents++;
  if (Math.abs(trip.windowPeakCorneringRad) > 0.6)    trip.corneringEvents++;

  // Reset peaks for next window
  trip.windowPeakBrakingMs2   = 0;
  trip.windowPeakCorneringRad = 0;
}

function jit(val: number, pct = 3): number {
  return Math.round((val + val * (pct / 100) * (Math.random() * 2 - 1)) * 100) / 100;
}

function synthesizeObd(offsetSec: number, state: string | null): OBDReading {
  // Baseline: city driving in Colombo, Toyota Aqua (hybrid), engine running
  let rpm     = 900 + Math.random() * 1800;
  let speed   = 15 + Math.random() * 55;   // 15–70 km/h city
  let coolant = jit(91, 4);                // 87–95°C normal
  let voltage = jit(13.9, 1.5);            // 13.7–14.1 V (alternator charging)
  let ltft    = (Math.random() - 0.5) * 5; // -2.5 to +2.5 % normal
  let throttle= 8 + Math.random() * 32;
  let load    = 15 + Math.random() * 45;
  let iat     = jit(39, 8);               // 36–42°C intake air

  switch (state) {
    case "OVERHEATED":
      coolant  = 101 + Math.random() * 6;  // 101–107°C
      load    += 25;
      rpm     += 400;
      break;
    case "BATTERY_DRAIN":
      voltage  = 10.8 + Math.random() * 0.8;
      break;
    case "BATTERY_AGED":
      voltage  = 12.1 + Math.random() * 1.0;
      break;
    case "BRAKE_WORN":
      // No direct OBD signature — shows in IMU (heavier braking intensity)
      break;
    case "FUEL_LOW":
      // Fuel level not in this batch; higher throttle from strain
      throttle += 10;
      break;
  }

  return {
    timestamp_offset_sec: offsetSec,
    rpm:               Math.round(Math.max(700, rpm)),
    speed_kmh:         Math.round(speed * 10) / 10,
    coolant_temp_c:    Math.round(coolant * 10) / 10,
    battery_voltage_v: Math.round(voltage * 100) / 100,
    ltft_percent:      Math.round(ltft * 100) / 100,
    throttle_percent:  Math.round(Math.min(throttle, 95)),
    engine_load_percent: Math.round(Math.min(load, 95)),
    intake_air_temp_c: Math.round(iat * 10) / 10,
  };
}

function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
