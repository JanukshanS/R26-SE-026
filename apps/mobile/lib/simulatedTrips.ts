/**
 * ============================================================================
 * Simulated trip history — manufacturing mileage for demos and testing
 * ============================================================================
 *
 * WHY: a newly registered vehicle has perfect health, and the wear models only
 * move once real mileage accumulates — brake pads are scored against a
 * 40,000 km life, tires 50,000 km. Demonstrating that a component degrades
 * therefore needs thousands of kilometres that nobody is going to drive.
 *
 * THIS LIVES IN KADUNA, NOT IN THE EXTERNAL SIMULATOR APP, for one decisive
 * reason: the account. Generating history is a WRITE against a specific
 * vehicle, and every write to /process-trip is authenticated. Here, the
 * session, the selected vehicle and the driver id are already in hand, so the
 * whole feature is a single button with nothing to type. Run from a separate
 * app it needed an email, a password, a vehicle id and a driver id — four
 * chances to mistype something, to authenticate the wrong account, or to write
 * history onto the wrong car.
 *
 * THE CONSTRAINT THAT SHAPES THE GENERATOR: distance is not ours to declare.
 * The backend recomputes it by trapezoidal integration over the speed readings
 * we send (`_estimate_distance_km` in ingest.py). A trip claiming 60 km whose
 * readings only support 4 km is STORED as 4 km. So the numbers below are built
 * to integrate to the distance they claim, and the claim is then checked
 * against the server's own arithmetic before anything is sent.
 */
import { submitTrip, type IMUReading, type OBDReading, type TripBatch } from "./maintenanceApi";

// ── The backend's rules, mirrored ───────────────────────────────────────────
// From components/predictive-maintenance/app/routers/ingest.py and schemas.py.
// Duplicated deliberately: a generator that does not know the acceptance rules
// produces rejects, and a 422 halfway through a long run is expensive to debug.

/** Anything under these is refused with a 422. */
const MIN_TRIP_MINUTES = 2;
const MIN_DISTANCE_KM = 0.5;

/** Intervals longer than this are capped when the server integrates. */
const MAX_SAMPLE_GAP_SEC = 900;

/** `ge=`/`le=` bounds on OBDReading. One breach fails the whole POST. */
const RANGES = {
  rpm: [0, 8000],
  speed_kmh: [0, 300],
  coolant_temp_c: [0, 150],
  battery_voltage_v: [0, 20],
  ltft_percent: [-30, 30],
  throttle_percent: [0, 100],
  engine_load_percent: [0, 100],
  intake_air_temp_c: [-20, 100],
} as const;

/** 2 = real offsets + behaviour block. */
const CLIENT_SCHEMA_VERSION = 2;

/**
 * Seconds between generated OBD samples.
 *
 * Not the production 300 s. The server integrates speed as a trapezoid between
 * consecutive samples, so sparse sampling across a stop-start cycle can bill a
 * whole gap as cruising and overstate distance badly. At 15 s the integration
 * error against the intended distance stays under a percent, and the payload
 * for a typical trip is still only a few hundred rows.
 */
const OBD_SAMPLE_SEC = 15;
const IMU_SAMPLE_SEC = 60;

// ── Driving profiles ────────────────────────────────────────────────────────

/**
 * A profile decides WHICH component wears, which is the whole point of being
 * able to choose one.
 *
 * Brake pads wear on braking EVENTS, not on distance — 6,000 km of motorway
 * cruising barely touches them, while the same distance of city stop-start
 * chews through them. Tires respond to cornering and speed, the battery to
 * voltage behaviour and short hops. So "6,000 km" alone does not determine
 * what the health screen will show; this does.
 */
export interface DriveProfile {
  id: string;
  label: string;
  description: string;
  /** Typical cruising speed, km/h. */
  cruiseKmh: number;
  /** Stops per km — the dominant term in brake wear. */
  stopsPerKm: number;
  /** Typical braking deceleration, m/s^2. */
  decelMs2: number;
  /** Typical acceleration, m/s^2. */
  accelMs2: number;
  /** Coolant equilibrium, deg C. */
  coolantC: number;
  /** Charging voltage while running. */
  runningVoltage: number;
  /** Long-term fuel trim centre, %. */
  ltftCenter: number;
}

export const DRIVE_PROFILES: DriveProfile[] = [
  {
    id: "city",
    label: "City driving",
    description:
      "Stop-start traffic with frequent, firm braking. The fastest way to show BRAKE wear.",
    cruiseKmh: 34,
    stopsPerKm: 1.4,
    decelMs2: 3.2,
    accelMs2: 2.2,
    coolantC: 94,
    runningVoltage: 14.0,
    ltftCenter: 2.5,
  },
  {
    id: "highway",
    label: "Highway driving",
    description:
      "Long steady runs, little braking. Accumulates distance for TIRE and ENGINE wear while sparing the brakes.",
    cruiseKmh: 92,
    stopsPerKm: 0.06,
    decelMs2: 1.6,
    accelMs2: 1.4,
    coolantC: 88,
    runningVoltage: 14.1,
    ltftCenter: 1.2,
  },
  {
    id: "mixed",
    label: "Mixed driving",
    description: "A realistic blend of town and open road. Wears everything at a believable rate.",
    cruiseKmh: 58,
    stopsPerKm: 0.5,
    decelMs2: 2.4,
    accelMs2: 1.8,
    coolantC: 90,
    runningVoltage: 14.05,
    ltftCenter: 1.8,
  },
  {
    id: "harsh",
    label: "Harsh driving",
    description:
      "Hard acceleration and late, heavy braking. Degrades brakes and tires fastest, and drags the driver score down.",
    cruiseKmh: 76,
    stopsPerKm: 0.9,
    decelMs2: 4.6,
    accelMs2: 3.4,
    coolantC: 97,
    runningVoltage: 14.2,
    ltftCenter: 3.6,
  },
];

export function profileById(id: string): DriveProfile {
  return DRIVE_PROFILES.find((p) => p.id === id) ?? DRIVE_PROFILES[2];
}

// ── Generation ──────────────────────────────────────────────────────────────

export interface SimulatedTripsProgress {
  phase: "generating" | "uploading" | "done";
  done: number;
  total: number;
  kmStored: number;
  failed: number;
}

export interface SimulatedTripsResult {
  tripsSent: number;
  kmStored: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
  firstError?: string;
}

/** Deterministic PRNG so a repeated run behaves the same way twice. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
  Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    return (c === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

/**
 * The server's `_estimate_distance_km`, mirrored.
 *
 * This is the number that will actually be stored, so it is the number the
 * generator checks itself against — not its own idea of how far it drove.
 */
function serverDistanceKm(readings: OBDReading[]): number {
  if (readings.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < readings.length; i++) {
    const dt = Math.min(
      readings[i].timestamp_offset_sec - readings[i - 1].timestamp_offset_sec,
      MAX_SAMPLE_GAP_SEC
    );
    if (dt <= 0) continue;
    sum += 0.5 * (readings[i].speed_kmh + readings[i - 1].speed_kmh) * dt;
  }
  return sum / 3600;
}

/**
 * Build one trip covering roughly `targetKm`.
 *
 * The speed trace is a repeating drive cycle — accelerate, cruise, brake,
 * idle — whose stop frequency comes from the profile. That shape matters more
 * than it looks: the backend counts braking events and cornering from the
 * behaviour block, but it derives DISTANCE from these speeds, so a trace that
 * is merely "a plausible number near the cruise speed" would produce wear
 * signals that disagree with the mileage they are supposed to accompany.
 */
function generateTrip(opts: {
  vehicleId: string;
  driverId: string;
  profile: DriveProfile;
  targetKm: number;
  startMs: number;
  seed: number;
}): { batch: TripBatch; distanceKm: number; durationSec: number } | null {
  const { profile: p } = opts;
  const rand = rng(opts.seed);

  const obd: OBDReading[] = [];
  const imu: IMUReading[] = [];

  // Distance between stops, from the profile. Guarded against absurd values so
  // a zero-stop profile does not divide by zero.
  const kmBetweenStops = p.stopsPerKm > 0 ? 1 / p.stopsPerKm : 50;
  const cruise = p.cruiseKmh;

  let t = 0;
  let km = 0;
  let speed = 0;
  let sinceObd = Infinity;
  let sinceImu = Infinity;
  let coolant = 28;
  let brakeEvents = 0;
  let accelEvents = 0;
  let decelSum = 0;
  let decelCount = 0;
  let maxDecel = 0;
  let kmSinceStop = 0;

  // "Phase" is where we are in the drive cycle.
  type Phase = "accel" | "cruise" | "brake" | "idle";
  let phase: Phase = "accel";
  let idleLeft = 0;

  const STEP = 1; // second
  const MAX_SEC = 6 * 3600;

  while (t < MAX_SEC && km < opts.targetKm) {
    const prevSpeed = speed;

    switch (phase) {
      case "accel": {
        speed = Math.min(cruise, speed + p.accelMs2 * 3.6 * STEP);
        if (speed >= cruise * 0.97) phase = "cruise";
        break;
      }
      case "cruise": {
        // Small wander so the trace is not a flat line, which both looks fake
        // and makes the trapezoid suspiciously exact.
        speed = Math.max(5, cruise + (rand() - 0.5) * cruise * 0.12);
        if (kmSinceStop >= kmBetweenStops) phase = "brake";
        break;
      }
      case "brake": {
        speed = Math.max(0, speed - p.decelMs2 * 3.6 * STEP);
        if (speed <= 0.5) {
          phase = "idle";
          // Longer waits in heavier traffic.
          idleLeft = 4 + rand() * (p.stopsPerKm > 0.8 ? 30 : 10);
          kmSinceStop = 0;
          brakeEvents += 1;
        }
        break;
      }
      case "idle": {
        speed = 0;
        idleLeft -= STEP;
        if (idleLeft <= 0) {
          phase = "accel";
          accelEvents += 1;
        }
        break;
      }
    }

    const dv = (speed - prevSpeed) / 3.6; // m/s
    const a = dv / STEP;
    if (a < 0) {
      decelSum += -a;
      decelCount += 1;
      if (-a > maxDecel) maxDecel = -a;
    }

    const stepKm = ((prevSpeed + speed) / 2 / 3600) * STEP;
    km += stepKm;
    kmSinceStop += stepKm;

    // Coolant warms toward the profile's equilibrium over a few minutes.
    coolant += (p.coolantC - coolant) * (STEP / 240);

    t += STEP;
    sinceObd += STEP;
    sinceImu += STEP;

    if (sinceObd >= OBD_SAMPLE_SEC) {
      obd.push(sampleObd(speed, coolant, p, rand, Math.round(t)));
      sinceObd = 0;
    }
    if (sinceImu >= IMU_SAMPLE_SEC) {
      imu.push(sampleImu(a, speed, Math.round(t)));
      sinceImu = 0;
    }
  }

  // Close the trace so the final leg is integrated, without duplicating an
  // offset (a zero-width interval would be malformed, if harmless).
  const tEnd = Math.round(t);
  if (obd.length === 0 || obd[obd.length - 1].timestamp_offset_sec < tEnd) {
    obd.push(sampleObd(speed, coolant, p, rand, tEnd));
  }
  if (imu.length === 0 || imu[imu.length - 1].timestamp_offset_sec < tEnd) {
    imu.push(sampleImu(0, speed, tEnd));
  }

  const distanceKm = serverDistanceKm(obd);
  const durationSec = tEnd;

  // Refuse rather than submit something the backend will reject. Returning
  // null keeps the decision here, where the reason is known, instead of
  // surfacing as an opaque 422 later.
  if (
    distanceKm < MIN_DISTANCE_KM ||
    durationSec < MIN_TRIP_MINUTES * 60 ||
    obd.length < 2 ||
    imu.length < 2
  ) {
    return null;
  }

  const durationMin = Math.max(1, durationSec / 60);

  return {
    distanceKm,
    durationSec,
    batch: {
      trip_id: uuid(),
      vehicle_id: opts.vehicleId,
      driver_id: opts.driverId,
      start_timestamp: new Date(opts.startMs).toISOString(),
      end_timestamp: new Date(opts.startMs + durationSec * 1000).toISOString(),
      client_schema_version: CLIENT_SCHEMA_VERSION,
      obd_readings: obd,
      imu_readings: imu,
      behavior: {
        steering_reversal_rate: r2(Math.min(60, p.stopsPerKm * 8 + 2)),
        steering_smoothness_index: r2(p.decelMs2 * 0.08),
        swerve_events: Math.round(brakeEvents * 0.04),
        yaw_rate_p95: r2(Math.min(10, p.decelMs2 * 0.12)),
        yaw_rate_max: r2(Math.min(10, p.decelMs2 * 0.2)),

        harsh_braking_events: brakeEvents,
        harsh_accel_events: accelEvents,
        avg_decel_intensity: r2(decelCount ? decelSum / decelCount : 0),
        avg_accel_intensity: r2(p.accelMs2 * 0.6),
        max_decel_ms2: r2(Math.min(30, maxDecel)),
        longitudinal_jerk_rms: r2(p.decelMs2 * 0.3),

        harsh_cornering_events: Math.round(brakeEvents * 0.3),
        lateral_g_max: r2(Math.min(3, p.decelMs2 * 0.09)),
        lateral_g_p95: r2(Math.min(3, p.decelMs2 * 0.06)),

        imu_sample_count: imu.length,
        mount_stable: true,
        // Honest about provenance. Claiming high confidence would have the
        // backend weight synthesised behaviour as heavily as measured.
        axis_confidence: 0.85,
        sensor_dropout_sec: 0,
        synthetic_obd_count: 0,
      },
    },
  };
}

function sampleObd(
  speed: number,
  coolant: number,
  p: DriveProfile,
  rand: () => number,
  offsetSec: number
): OBDReading {
  const moving = speed > 1;
  // RPM from speed via a notional gear, lifted off idle so a stopped engine
  // still idles rather than reading zero while "running".
  const rpm = moving ? 850 + (speed / p.cruiseKmh) * 1600 + rand() * 120 : 780 + rand() * 60;
  const throttle = moving ? 14 + (speed / Math.max(1, p.cruiseKmh)) * 26 + rand() * 8 : 8 + rand() * 3;

  return {
    timestamp_offset_sec: offsetSec,
    rpm: Math.round(clamp(rpm, RANGES.rpm)),
    speed_kmh: r1(clamp(speed, RANGES.speed_kmh)),
    coolant_temp_c: r1(clamp(coolant, RANGES.coolant_temp_c)),
    battery_voltage_v: r2(clamp(p.runningVoltage - 0.1 + (rand() - 0.5) * 0.2, RANGES.battery_voltage_v)),
    ltft_percent: r2(clamp(p.ltftCenter + (rand() - 0.5) * 1.6, RANGES.ltft_percent)),
    throttle_percent: r1(clamp(throttle, RANGES.throttle_percent)),
    engine_load_percent: r1(clamp(12 + throttle * 0.8, RANGES.engine_load_percent)),
    intake_air_temp_c: r1(clamp(30 + coolant / 12, RANGES.intake_air_temp_c)),
  };
}

function sampleImu(longitudinalMs2: number, speedKmh: number, offsetSec: number): IMUReading {
  const G = 9.80665;
  return {
    timestamp_offset_sec: offsetSec,
    accel_x: 0,
    accel_y: r2(longitudinalMs2),
    accel_z: r2(G),
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: r2(speedKmh > 1 ? 0.02 : 0),
  };
}

/**
 * Generate and upload a history covering `targetKm`.
 *
 * Trips are sent OLDEST FIRST. The backend clamps component health
 * monotonically (a health floor), so arriving newest-first would let the most
 * recent trip set a floor the older ones can never move, flattening the very
 * curve this exists to produce.
 */
export async function generateAndUploadHistory(opts: {
  vehicleId: string;
  driverId: string;
  targetKm: number;
  profile: DriveProfile;
  /** Spread the history back over this many days. */
  spanDays?: number;
  onProgress?: (p: SimulatedTripsProgress) => void;
}): Promise<SimulatedTripsResult> {
  const started = Date.now();
  const spanDays = opts.spanDays ?? 180;
  const rand = rng(20260823);

  // Plan trip lengths first so total count is known and progress is honest.
  const lengths: number[] = [];
  let remaining = opts.targetKm;
  while (remaining > 0) {
    const want = 8 + rand() * 55;
    // Absorb a final stub rather than emit a trip under the 0.5 km floor.
    lengths.push(remaining - want < 8 ? remaining : want);
    remaining -= lengths[lengths.length - 1];
  }

  const total = lengths.length;
  const endMs = Date.now();
  const spanMs = spanDays * 24 * 3600 * 1000;
  const gap = spanMs / Math.max(1, total);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let kmStored = 0;
  let firstError: string | undefined;

  for (let i = 0; i < total; i++) {
    opts.onProgress?.({ phase: "generating", done: i, total, kmStored, failed });

    const trip = generateTrip({
      vehicleId: opts.vehicleId,
      driverId: opts.driverId,
      profile: opts.profile,
      targetKm: lengths[i],
      startMs: endMs - spanMs + i * gap + rand() * gap * 0.5,
      seed: 1000 + i * 7919,
    });

    if (!trip) {
      skipped += 1;
      continue;
    }

    opts.onProgress?.({ phase: "uploading", done: i, total, kmStored, failed });

    try {
      await submitTrip(trip.batch);
      sent += 1;
      kmStored += trip.distanceKm;
    } catch (e: any) {
      // 409 means the backend already has this trip — a success from our point
      // of view, and the expected outcome when a run is repeated.
      const status = e?.status;
      if (status === 409) {
        sent += 1;
        kmStored += trip.distanceKm;
      } else {
        failed += 1;
        if (!firstError) firstError = e?.message ?? String(e);
      }
    }

    // Yield so the UI can paint. Without this the whole run is one blocking
    // stretch and a working feature looks hung.
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }

  opts.onProgress?.({ phase: "done", done: total, total, kmStored, failed });

  return { tripsSent: sent, kmStored, failed, skipped, elapsedMs: Date.now() - started, firstError };
}
