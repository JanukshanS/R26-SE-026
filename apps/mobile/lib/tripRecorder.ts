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
import { scanDtcCodes } from "@lib/elm327.classic";
import type { DtcScan } from "@lib/elm327.dtc";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { getPairing, isRealBackend, readRawObdPids } from "./elm327";
import {
  createBehaviorAccumulator,
  type BehaviorAccumulator,
  type TripBehavior,
} from "./driverBehavior";
import type { IMUReading, OBDReading, TripBatch } from "./maintenanceApi";

// Sensors are only available on native (iOS/Android). On web we fall back to
// synthetic IMU data derived from the OBD state so the UI still works.
const SENSORS_AVAILABLE = Platform.OS !== "web";

// ── Interval config ───────────────────────────────────────────────────────────
// Prod: 5 min OBD, 2 min IMU — matches the backend spec.
// Dev:  30 s OBD, 10 s IMU — a usable demo trip in about a minute.
// Fast: 3 s OBD, 2 s IMU — for verifying the pipeline end to end in a hurry.
//
// FAST MODE EXISTS BECAUSE OF A MISMATCH IN WHAT "QUICK TEST" CAN MEAN. Sample
// SPACING and trip LENGTH are separate limits, and only one of them is ours to
// set: the backend rejects any trip under 2 minutes or 0.5 km (MIN_TRIP_MINUTES
// / MIN_DISTANCE_KM in ingest.py). Sampling faster does not shorten that floor.
// What it does buy is DENSITY — at 30 s a two-minute trip yields four OBD rows,
// which is barely above the 2-row schema minimum and leaves the trapezoidal
// distance estimate riding on a handful of points. At 3 s the same two minutes
// yields forty, so a short verification run produces data worth looking at
// instead of data that merely passes validation.
const IS_DEV = __DEV__;
const FAST_SAMPLING = process.env.EXPO_PUBLIC_TRIP_SAMPLE_FAST === "true";

export const OBD_INTERVAL_MS = FAST_SAMPLING ? 3_000 : IS_DEV ? 30_000 : 300_000;
export const IMU_INTERVAL_MS = FAST_SAMPLING ? 2_000 : IS_DEV ? 10_000 : 120_000;
// Fallback spacing, used only if a real elapsed time can't be computed. The
// batch now carries REAL offsets (seconds since trip start) rather than
// index * step: the backend derives duration and distance from them, so
// index-derived values made a dev-mode trip report 10x its real distance.
const OBD_OFFSET_STEP         = 300;   // seconds
const IMU_OFFSET_STEP         = 120;   // seconds

/** Wire-format version. 2 = real offsets + on-device behaviour block. */
const CLIENT_SCHEMA_VERSION = 2;

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
  /**
   * Distance so far, km — computed the way the SERVER computes it (trapezoidal
   * integration over the speed readings). Deliberately not a separate running
   * total: the number shown live should be the number that ends up stored, or
   * the screen quietly disagrees with the trip history.
   */
  distanceKm: number;
  brakingEvents: number;
  corneringEvents: number;
  canEnd: boolean;        // true when min readings reached
}

/** How the trip was started. Auto trips get extra guardrails and UI. */
export type TripOrigin = "manual" | "auto";

interface ActiveTrip {
  tripId: string;
  vehicleId: string;
  driverId: string;
  startTimestamp: string;
  startedAt: number;
  origin: TripOrigin;
  obdReadings: OBDReading[];
  imuReadings: IMUReading[];
  /**
   * Analyses the raw 4 Hz stream: removes gravity, derives yaw about the
   * gravity vector, and accumulates steering/braking/cornering metrics. The
   * per-window peaks below come from here too — the old code read raw
   * accelerometer values that still included gravity, which is why harsh
   * braking was never once detected.
   */
  behavior: BehaviorAccumulator;
  /** Timestamps of the last accel/gyro sample, for real per-sample dt. */
  lastAccelAt: number;
  lastGyroAt: number;
  // event tallies for the UI
  brakingEvents: number;
  corneringEvents: number;
  lastObdAt: number;
  /** OBD samples skipped because a real dongle was paired but didn't answer. */
  syntheticObdMisses: number;
  /** Best speed evidence, for the auto-trip false-start check. */
  maxSpeedKmh: number;
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

/**
 * `_estimate_distance_km` from ingest.py, mirrored so the live figure matches
 * what the backend will store. The 900 s cap is the server's own: it stops a
 * long sampling gap (a backgrounded app) from being billed as continuous
 * driving.
 */
function distanceSoFarKm(readings: OBDReading[]): number {
  if (readings.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < readings.length; i++) {
    const dt = Math.min(
      readings[i].timestamp_offset_sec - readings[i - 1].timestamp_offset_sec,
      900
    );
    if (dt <= 0) continue;
    sum += 0.5 * (readings[i].speed_kmh + readings[i - 1].speed_kmh) * dt;
  }
  return sum / 3600;
}

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
    distanceKm:    distanceSoFarKm(trip.obdReadings),
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

export function startTrip(
  vehicleId: string,
  driverId: string,
  opts?: { origin?: TripOrigin }
): string {
  if (trip) throw new Error("Trip already active — call endTrip() first.");

  const now = Date.now();
  trip = {
    tripId:           generateUuid(),
    vehicleId,
    driverId,
    startTimestamp:   new Date(now).toISOString(),
    startedAt:        now,
    origin:           opts?.origin ?? "manual",
    obdReadings:      [],
    imuReadings:      [],
    behavior:         createBehaviorAccumulator(),
    lastAccelAt:      now,
    lastGyroAt:       now,
    brakingEvents:    0,
    corneringEvents:  0,
    lastObdAt:        now,
    syntheticObdMisses: 0,
    maxSpeedKmh:      0,
  };

  // Real phone sensors at 4 Hz (native only — web uses synthetic IMU).
  // Both listeners feed the behaviour accumulator raw, in the units
  // expo-sensors reports (accel in g INCLUDING gravity, gyro in rad/s); the
  // accumulator removes gravity itself. Passing pre-scaled values here was the
  // original bug.
  if (SENSORS_AVAILABLE) {
    Accelerometer.setUpdateInterval(250);
    accelSub = Accelerometer.addListener(({ x, y, z }) => {
      if (!trip) return;
      const t = Date.now();
      const dtSec = (t - trip.lastAccelAt) / 1000;
      trip.lastAccelAt = t;
      trip.behavior.addAccel({ ax: x, ay: y, az: z, dtSec });
    });

    Gyroscope.setUpdateInterval(250);
    gyroSub = Gyroscope.addListener(({ x, y, z }) => {
      if (!trip) return;
      const t = Date.now();
      const dtSec = (t - trip.lastGyroAt) / 1000;
      trip.lastGyroAt = t;
      trip.behavior.addGyro({ gx: x, gy: y, gz: z, dtSec });
    });
  }

  // First OBD snapshot immediately (fire-and-forget — a real dongle read
  // takes a moment; obdCount just updates a beat later than IMU's).
  void captureObd();

  obdTimer = setInterval(() => { void captureObd().then(notify); }, OBD_INTERVAL_MS);
  imuTimer = setInterval(() => { captureImu(); notify(); }, IMU_INTERVAL_MS);

  console.log(`[tripRecorder] trip started id=${trip.tripId.slice(0, 8)} origin=${trip.origin} vehicle=${vehicleId}`);
  // Subscribers (home's TripCard) need to learn the trip exists. Previously
  // only the interval callbacks notified, so the card went stale the moment a
  // trip started or ended anywhere other than its own press handler.
  notify();

  return trip.tripId;
}

/**
 * Stop timers and sensor subscriptions and clear the active trip.
 *
 * Shared by endTrip and abortTrip deliberately: this is the ONLY place the
 * subscriptions are removed, so a second hand-copied teardown would rot the
 * moment another subscription is added.
 */
function teardown(): ActiveTrip | null {
  if (obdTimer) { clearInterval(obdTimer); obdTimer = null; }
  if (imuTimer) { clearInterval(imuTimer); imuTimer = null; }
  if (SENSORS_AVAILABLE) {
    accelSub?.remove(); accelSub = null;
    gyroSub?.remove();  gyroSub  = null;
  }
  const completed = trip;
  trip = null;
  notify();
  return completed;
}

/** A silent adapter must not stall the end of a trip. */
const DTC_SCAN_TIMEOUT_MS = 6000;

export async function endTrip(): Promise<TripBatch> {
  if (!trip) throw new Error("No active trip.");

  // Final snapshots
  await captureObd();
  captureImu();

  const durationSec = Math.max(1, Math.round((Date.now() - trip.startedAt) / 1000));
  const behavior = trip.behavior.finalize(durationSec);
  behavior.synthetic_obd_count = trip.syntheticObdMisses;

  // Codes are read BEFORE teardown, while the link is still live and the
  // engine has only just stopped. Wrapped and time-boxed because a trip that
  // was genuinely recorded must never be lost to a diagnostics read that hung:
  // a failed scan reports readOk=false, which the server treats as "not
  // checked" rather than "nothing wrong".
  let dtcScan: DtcScan = { codes: [], readOk: false };
  try {
    dtcScan = await Promise.race([
      scanDtcCodes(),
      new Promise<DtcScan>((resolve) =>
        setTimeout(() => resolve({ codes: [], readOk: false }), DTC_SCAN_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.log("[tripRecorder] DTC scan failed, trip continues without codes:", err);
  }

  const completed = teardown()!;

  // One line that makes a whole drive diagnosable without scrolling.
  console.log(
    `[tripRecorder] dtc scan  ok=${dtcScan.readOk}  codes=${dtcScan.codes.map((c) => c.code).join(",") || "none"}`
  );

  console.log(
    `[tripRecorder] trip ended  origin=${completed.origin}  dur=${(durationSec / 60).toFixed(1)}min  ` +
    `obd=${completed.obdReadings.length}(${completed.syntheticObdMisses} skipped)  imu=${completed.imuReadings.length}  ` +
    `steering=${behavior.steering_reversal_rate.toFixed(1)}rev/min  swerve=${behavior.swerve_events}  ` +
    `brake=${behavior.harsh_braking_events}  accel=${behavior.harsh_accel_events}  corner=${behavior.harsh_cornering_events}  ` +
    `latG_p95=${behavior.lateral_g_p95.toFixed(2)}  axisConf=${behavior.axis_confidence.toFixed(2)}  ` +
    `mountStable=${behavior.mount_stable}`
  );

  return {
    trip_id:         completed.tripId,
    vehicle_id:      completed.vehicleId,
    driver_id:       completed.driverId,
    start_timestamp: completed.startTimestamp,
    end_timestamp:   new Date().toISOString(),
    client_schema_version: CLIENT_SCHEMA_VERSION,
    obd_readings:    completed.obdReadings,
    imu_readings:    completed.imuReadings,
    behavior,
    dtcs:            dtcScan.codes,
    dtc_read_ok:     dtcScan.readOk,
  };
}

/**
 * Discard the active trip WITHOUT producing a batch.
 *
 * Needed by the auto-trip guardrails: a trip auto-started by a voltage
 * artefact (battery charger, jump start) that never sees real motion must be
 * thrown away, not submitted. endTrip always yields data, so it can't express
 * "this never happened".
 */
export function abortTrip(reason: string): void {
  if (!trip) return;
  const t = trip;
  teardown();
  console.log(
    `[tripRecorder] trip ABORTED id=${t.tripId.slice(0, 8)} origin=${t.origin} — ${reason} ` +
    `(discarded ${t.obdReadings.length} OBD + ${t.imuReadings.length} IMU readings)`
  );
}

/** Origin of the active trip, or null when none is running. */
export function getTripOrigin(): TripOrigin | null {
  return trip?.origin ?? null;
}

/** Motion evidence for the auto-controller's false-start check. */
export function getMotionEvidence(): { maxSpeedKmh: number; elapsedSec: number } | null {
  if (!trip) return null;
  return {
    maxSpeedKmh: trip.maxSpeedKmh,
    elapsedSec: Math.round((Date.now() - trip.startedAt) / 1000),
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function notify() { listeners.forEach(cb => cb()); }

async function captureObd() {
  if (!trip) return;
  const idx      = trip.obdReadings.length;
  const pairing  = getPairing();
  // REAL seconds since trip start. The backend derives duration and distance
  // from these; index * step made distance a function of how many samples
  // arrived rather than of elapsed time.
  const offsetSec = Math.round((Date.now() - trip.startedAt) / 1000);

  const real = await readRawObdPids();

  // ── EVERY VALUE IN A TRIP COMES FROM THE ADAPTER. NOTHING IS INVENTED. ──
  //
  // This used to fall back to a synthesizer: per-field for anything the car
  // did not answer, and wholesale when no dongle was connected at all. Both
  // are gone. Fabricated telemetry is indistinguishable from measured
  // telemetry once it is in the database — it trains the wear models, moves
  // the health percentages and shows up in the trip history as though a car
  // had produced it. A trip with no adapter behind it is not a short trip or a
  // low-quality trip, it is not a trip, and the only correct number of
  // invented readings to store is zero.
  //
  // A missed sample is cheap by comparison: the backend caps sampling gaps
  // when it integrates, and a trip that ends up with too few readings is
  // caught by the guardrails and discarded rather than sent.
  // Re-check: `trip` is module-level and the await above yields, so the trip
  // can be torn down mid-read — which is EXACTLY what happens at the end of a
  // trip, when the ignition goes off while a poll is in flight. The original
  // code guarded this and the rewrite that removed the synthetic fallback
  // dropped it, turning the most ordinary moment in a trip's life into an
  // unhandled null dereference.
  if (!trip) return;

  if (!real) {
    trip.syntheticObdMisses += 1;
    console.log(
      `[tripRecorder] OBD snapshot #${idx} SKIPPED: adapter did not answer ` +
      `(total skipped ${trip.syntheticObdMisses}) — not fabricating data`
    );
    return;
  }

  // A partial answer is skipped for the same reason. OBDReading has no
  // optional fields — the backend requires all eight — so filling a gap means
  // inventing a value, which is the thing this function no longer does. The
  // missing PID is named so a car that genuinely cannot report one is
  // diagnosable from the log rather than silently recording nothing.
  const REQUIRED = [
    "rpm", "speed_kmh", "coolant_temp_c", "battery_voltage_v",
    "ltft_percent", "throttle_percent", "engine_load_percent", "intake_air_temp_c",
  ] as const;
  const missing = REQUIRED.filter((k) => real[k] === undefined);
  if (missing.length > 0) {
    if (!trip) return;
    trip.syntheticObdMisses += 1;
    console.log(
      `[tripRecorder] OBD snapshot #${idx} SKIPPED: adapter did not report ` +
      `[${missing.join(",")}] (total skipped ${trip.syntheticObdMisses}) — not fabricating data`
    );
    return;
  }

  const reading: OBDReading = {
    timestamp_offset_sec: offsetSec,
    rpm:                 real.rpm!,
    speed_kmh:           real.speed_kmh!,
    coolant_temp_c:      real.coolant_temp_c!,
    battery_voltage_v:   real.battery_voltage_v!,
    ltft_percent:        real.ltft_percent!,
    throttle_percent:    real.throttle_percent!,
    engine_load_percent: real.engine_load_percent!,
    intake_air_temp_c:   real.intake_air_temp_c!,
  };

  console.log(
    `[tripRecorder] OBD snapshot #${idx}: 8/8 fields from the adapter — ` +
    `${reading.speed_kmh}km/h ${reading.rpm}rpm ${reading.battery_voltage_v}V`
  );

  if (!trip) return; // trip may have ended while the read was in flight
  trip.obdReadings.push(reading);
  trip.lastObdAt = Date.now();
  if (reading.speed_kmh > trip.maxSpeedKmh) trip.maxSpeedKmh = reading.speed_kmh;
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
      timestamp_offset_sec: Math.round((Date.now() - trip.startedAt) / 1000),
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

  // Native: peaks come from the behaviour accumulator, which has already
  // removed gravity and resolved yaw about the true vertical. Reading the raw
  // sensor values here (as the old code did) meant accel_z carried a ~9.81
  // gravity offset, so the backend's find_peaks(-accel_z, height=3.0) could
  // never fire — zero braking events across every trip ever recorded.
  const peaks = trip.behavior.closeWindow();
  const reading: IMUReading = {
    timestamp_offset_sec: Math.round((Date.now() - trip.startedAt) / 1000),
    accel_x: peaks.peakLateralMs2,
    accel_y: 0,
    accel_z: peaks.peakDecelMs2,        // negative during hard braking
    gyro_x:  0,
    gyro_y:  0,
    gyro_z:  peaks.peakYawRateRad,      // peaks on hard corners
  };
  trip.imuReadings.push(reading);

  // Live tallies for the UI, straight from the accumulator's own detectors
  // (debounced + refractory-limited) rather than re-thresholding here.
  const preview = trip.behavior.preview();
  trip.brakingEvents   = preview.harshBrakingEvents;
  trip.corneringEvents = preview.harshCorneringEvents;

  console.log(
    `[tripRecorder] IMU window #${idx}: decel=${peaks.peakDecelMs2.toFixed(2)}m/s2 ` +
    `yaw=${peaks.peakYawRateRad.toFixed(2)}rad/s lat=${peaks.peakLateralMs2.toFixed(2)}m/s2 ` +
    `| trip so far: brake=${preview.harshBrakingEvents} accel=${preview.harshAccelEvents} ` +
    `corner=${preview.harshCorneringEvents} swerve=${preview.swerveEvents} steer=${preview.steeringReversals}rev`
  );
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
