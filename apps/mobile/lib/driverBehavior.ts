/**
 * ============================================================================
 * Driver-behaviour analysis from the raw 4 Hz IMU stream
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Two independent problems with the previous approach:
 *
 * 1. GRAVITY WAS NEVER REMOVED. `expo-sensors` reports specific force in g
 *    INCLUDING gravity. The old code did `ay = y * 9.81` and tracked
 *    `min(ay, 0)`, so a phone sitting upright on a dash reads y ~ +1 g and the
 *    braking peak never went below zero — harsh braking was undetectable. Mount
 *    it the other way up and it pins at -9.81 and EVERY window is a braking
 *    event. There is no orientation in which that code was correct, and the
 *    database confirms it: zero braking events across every trip ever recorded.
 *
 * 2. 480 SAMPLES WERE COLLAPSED INTO 2 NUMBERS. The sensors run at 4 Hz but
 *    only one peak per 2-minute window survived into the batch. Steering
 *    behaviour is a property of the stream — reversal rate, jerk, swerves — and
 *    is irrecoverable from a per-window summary.
 *
 * MOUNT INDEPENDENCE
 * ------------------
 * We never assume how the phone is oriented. Gravity is estimated with a slow
 * low-pass filter, which gives the vehicle's vertical axis; yaw rate is then the
 * gyro component ABOUT that axis, which is correct for any rigid mount. Every
 * steering metric is defined on |yawRate| or on sign CHANGES, so even the sign
 * flipping with orientation doesn't matter.
 *
 * Separating braking from acceleration additionally needs to know which way is
 * forward. That is learned from the data (lateral acceleration correlates with
 * yaw rate: a_lat ~ v * yawRate) and gated behind a confidence score — until the
 * gate is met we report only direction-agnostic metrics rather than guessing.
 *
 * MEMORY
 * ------
 * Everything is O(1): running sums, counters, and three fixed histograms. A
 * five-hour trip costs exactly as much as a five-minute one.
 *
 * This module is deliberately free of expo/react-native imports so it can be
 * unit-tested directly under vitest.
 */

export const BEHAVIOR_TUNING = {
  /** Complementary-filter coefficient for the gravity estimate at 4 Hz.
   *  tau = dt*a/(1-a) ~ 12 s: long enough that a 4-second brake doesn't leak
   *  into the estimate, short enough to track a re-seated mount. */
  GRAVITY_ALPHA: 0.98,
  /** Samples ignored while the gravity estimate settles (~5 s at 4 Hz). */
  WARMUP_SAMPLES: 20,

  /** Yaw-rate deadband for the steering Schmitt trigger, rad/s (~2 deg/s).
   *  This IS the reversal-gap parameter: without it, sensor noise alone
   *  produces hundreds of "reversals" per minute. */
  YAW_DEADBAND_RAD: 0.035,
  /** A reversal pair inside this window counts as a swerve. */
  SWERVE_WINDOW_MS: 3000,
  /** Both sides of a swerve must exceed this peak yaw rate (~14 deg/s). */
  SWERVE_YAW_RAD: 0.25,

  /** Harsh-event thresholds, m/s^2. Braking is stronger than acceleration
   *  because no road car accelerates as hard as it brakes. */
  HARSH_BRAKE_MS2: 3.0,
  HARSH_ACCEL_MS2: 2.5,
  HARSH_CORNER_MS2: 3.0,
  /** Consecutive samples above threshold before an event counts (0.75 s at
   *  4 Hz). Stops a single pothole spike registering as a brake. */
  EVENT_DEBOUNCE_SAMPLES: 3,
  /** Minimum gap between distinct events of the same kind. Stops one traffic
   *  light registering as five. */
  EVENT_REFRACTORY_MS: 4000,

  /** Axis calibration gate — below this we don't claim to know forward. */
  AXIS_MIN_CONFIDENCE: 0.35,
  AXIS_MIN_SAMPLES: 600,
  /** Yaw rate below which a sample tells us nothing about the lateral axis. */
  AXIS_MIN_YAW_RAD: 0.05,
  /** Above this yaw rate, horizontal force is dominated by cornering.
   *  This is what lets us separate cornering from braking/acceleration WITHOUT
   *  knowing the phone's orientation: a car turning hard enough to matter is
   *  always yawing, and a car braking hard is essentially not. */
  CORNERING_YAW_RAD: 0.15,

  /** Mount considered unstable past this tilt change from trip start. */
  MOUNT_MAX_TILT_DEG: 15,

  /** Sampling gaps longer than this count as sensor dropout. */
  DROPOUT_GAP_SEC: 2.0,
} as const;

const G = 9.80665;
const HIST_BINS = 64;

export interface BehaviorSample {
  /** Accelerometer, in g, INCLUDING gravity (expo-sensors' native units). */
  ax: number;
  ay: number;
  az: number;
  dtSec: number;
}

export interface GyroSample {
  /** Gyroscope, rad/s. */
  gx: number;
  gy: number;
  gz: number;
  dtSec: number;
}

/** Per-window peaks, kept for the legacy IMUReading fields. */
export interface WindowPeaks {
  peakDecelMs2: number;
  peakYawRateRad: number;
  peakLateralMs2: number;
}

/** Cheap live snapshot for the active-trip UI. */
export interface BehaviorPreview {
  steeringReversals: number;
  swerveEvents: number;
  harshBrakingEvents: number;
  harshAccelEvents: number;
  harshCorneringEvents: number;
  lateralGMax: number;
}

/** The wire payload — mirrors the backend's optional TripBehavior schema. */
export interface TripBehavior {
  steering_reversal_rate: number;
  steering_smoothness_index: number;
  swerve_events: number;
  yaw_rate_p95: number;
  yaw_rate_max: number;

  harsh_braking_events: number;
  harsh_accel_events: number;
  avg_decel_intensity: number;
  avg_accel_intensity: number;
  max_decel_ms2: number;
  longitudinal_jerk_rms: number;

  harsh_cornering_events: number;
  lateral_g_max: number;
  lateral_g_p95: number;

  imu_sample_count: number;
  mount_stable: boolean;
  axis_confidence: number;
  sensor_dropout_sec: number;
  /**
   * OBD samples skipped because a real dongle was paired but stopped
   * answering. Filled in by the trip recorder, which owns that knowledge —
   * high values mean the OBD side of this trip is sparse and the trip should
   * carry less weight in vehicle-level aggregates.
   */
  synthetic_obd_count: number;
}

// ── Small helpers ──────────────────────────────────────────────────────────

function clampDt(dt: number): number {
  // Guard against garbage timestamps without silently trusting them.
  if (!Number.isFinite(dt) || dt <= 0) return 0.25;
  return Math.min(dt, 2.0);
}

/** Fixed-range histogram for percentile estimation in O(1) memory. */
class Histogram {
  private readonly counts = new Int32Array(HIST_BINS);
  private n = 0;
  constructor(private readonly max: number) {}

  add(v: number): void {
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((v / this.max) * HIST_BINS)));
    this.counts[idx] += 1;
    this.n += 1;
  }

  /** Values above the top edge clamp into the last bin, so an extreme p95 is
   *  slightly under-estimated. Callers track an exact max alongside. */
  percentile(p: number): number {
    if (this.n === 0) return 0;
    const target = p * this.n;
    let cum = 0;
    for (let i = 0; i < HIST_BINS; i++) {
      const next = cum + this.counts[i];
      if (next >= target) {
        const within = this.counts[i] > 0 ? (target - cum) / this.counts[i] : 0;
        return ((i + within) / HIST_BINS) * this.max;
      }
      cum = next;
    }
    return this.max;
  }
}

/** Debounced, refractory-limited threshold detector. */
class EventDetector {
  private above = 0;
  private lastAtMs = -Infinity;
  private peak = 0;
  count = 0;
  peakSum = 0;
  maxPeak = 0;

  constructor(
    private readonly threshold: number,
    private readonly debounce: number,
    private readonly refractoryMs: number
  ) {}

  update(value: number, tMs: number): void {
    if (value >= this.threshold) {
      this.above += 1;
      if (value > this.peak) this.peak = value;
      if (this.above === this.debounce && tMs - this.lastAtMs >= this.refractoryMs) {
        this.count += 1;
        this.lastAtMs = tMs;
      }
    } else {
      if (this.above >= this.debounce && this.peak > 0) {
        this.peakSum += this.peak;
        if (this.peak > this.maxPeak) this.maxPeak = this.peak;
      }
      this.above = 0;
      this.peak = 0;
    }
  }

  /** Close an event still in progress when the trip ends. */
  flush(): void {
    if (this.above >= this.debounce && this.peak > 0) {
      this.peakSum += this.peak;
      if (this.peak > this.maxPeak) this.maxPeak = this.peak;
      this.peak = 0;
      this.above = 0;
    }
  }

  get avgPeak(): number {
    return this.count > 0 ? this.peakSum / this.count : 0;
  }
}

export interface BehaviorAccumulator {
  addAccel(s: BehaviorSample): void;
  addGyro(s: GyroSample): void;
  closeWindow(): WindowPeaks;
  preview(): BehaviorPreview;
  finalize(durationSec: number): TripBehavior;
}

export function createBehaviorAccumulator(
  tuning: Partial<typeof BEHAVIOR_TUNING> = {}
): BehaviorAccumulator {
  const T = { ...BEHAVIOR_TUNING, ...tuning };

  // Gravity estimate, in g, in the phone frame.
  let gx = 0, gy = 0, gz = 0;
  let gravitySeeded = false;
  let accelSamples = 0;
  let tMs = 0;

  // Vertical unit vector (phone frame), refreshed on each accel sample. The
  // gyro listener projects onto the last value — it changes on a ~12 s
  // timescale, so <=250 ms staleness is immaterial.
  let ux = 0, uy = 0, uz = 1;
  let u0x = 0, u0y = 0, u0z = 1;
  let mountSeeded = false;
  let maxTiltDeg = 0;

  // Horizontal-plane basis (phone frame), rebuilt whenever u moves materially.
  let e1x = 1, e1y = 0, e1z = 0;
  let e2x = 0, e2y = 1, e2z = 0;

  // Latest horizontal acceleration in the (e1,e2) basis, m/s^2.
  let p = 0, q = 0;
  let latestYaw = 0;

  // Axis calibration: correlation of horizontal accel with yaw rate.
  let Sp = 0, Sq = 0, axisDenom = 0, axisSamples = 0;
  // Third moments in the (e1,e2) basis, for resolving forward vs backward at
  // finalize time without a second pass over the data.
  let m3ppp = 0, m3ppq = 0, m3pqq = 0, m3qqq = 0, m3n = 0;

  // Steering
  let steerState: -1 | 0 | 1 = 0;
  let reversals = 0;
  let lastReversalMs = -Infinity;
  let peakYawSinceReversal = 0;
  let prevPeakYaw = 0;
  let swerves = 0;
  let yawMax = 0;
  let prevYaw = 0;
  let yawJerkSumSq = 0, yawJerkN = 0;
  const yawHist = new Histogram(1.5);

  // Longitudinal / lateral
  let prevALon = 0;
  let lonJerkSumSq = 0, lonJerkN = 0;
  let latMax = 0;
  const lonHist = new Histogram(8);
  const latHist = new Histogram(8);

  const brakeDet = new EventDetector(T.HARSH_BRAKE_MS2, T.EVENT_DEBOUNCE_SAMPLES, T.EVENT_REFRACTORY_MS);
  const accelDet = new EventDetector(T.HARSH_ACCEL_MS2, T.EVENT_DEBOUNCE_SAMPLES, T.EVENT_REFRACTORY_MS);
  const cornerDet = new EventDetector(T.HARSH_CORNER_MS2, T.EVENT_DEBOUNCE_SAMPLES, T.EVENT_REFRACTORY_MS);

  let dropoutSec = 0;

  // Window peaks for the legacy per-window IMU fields.
  let winDecel = 0, winYaw = 0, winLat = 0;

  function rebuildBasis(): void {
    // Pick the phone axis least aligned with u, then Gram-Schmidt.
    const axmin = Math.abs(ux), aymin = Math.abs(uy), azmin = Math.abs(uz);
    let sx = 0, sy = 0, sz = 0;
    if (axmin <= aymin && axmin <= azmin) sx = 1;
    else if (aymin <= azmin) sy = 1;
    else sz = 1;

    const d = sx * ux + sy * uy + sz * uz;
    let bx = sx - d * ux, by = sy - d * uy, bz = sz - d * uz;
    const bn = Math.hypot(bx, by, bz) || 1;
    e1x = bx / bn; e1y = by / bn; e1z = bz / bn;
    // e2 = u x e1
    e2x = uy * e1z - uz * e1y;
    e2y = uz * e1x - ux * e1z;
    e2z = ux * e1y - uy * e1x;
  }

  /** Current best guess at the lateral direction in the (e1,e2) plane. */
  function lateralDir(): { lx: number; ly: number; conf: number } {
    const mag = Math.hypot(Sp, Sq);
    if (mag < 1e-9 || axisDenom < 1e-9) return { lx: 1, ly: 0, conf: 0 };
    return { lx: Sp / mag, ly: Sq / mag, conf: Math.min(1, mag / axisDenom) };
  }

  function addAccel(s: BehaviorSample): void {
    const dt = clampDt(s.dtSec);
    if (s.dtSec > T.DROPOUT_GAP_SEC) dropoutSec += s.dtSec;
    tMs += dt * 1000;
    accelSamples += 1;

    if (!gravitySeeded) {
      // Seed from the first sample rather than zero, or the first ~30 s reads
      // as one enormous false acceleration.
      gx = s.ax; gy = s.ay; gz = s.az;
      gravitySeeded = true;
    } else {
      const a = T.GRAVITY_ALPHA;
      gx = a * gx + (1 - a) * s.ax;
      gy = a * gy + (1 - a) * s.ay;
      gz = a * gz + (1 - a) * s.az;
    }

    const gn = Math.hypot(gx, gy, gz) || 1;
    ux = gx / gn; uy = gy / gn; uz = gz / gn;

    if (!mountSeeded && accelSamples >= T.WARMUP_SAMPLES) {
      u0x = ux; u0y = uy; u0z = uz;
      mountSeeded = true;
      rebuildBasis();
    }
    if (mountSeeded) {
      const dot = Math.max(-1, Math.min(1, ux * u0x + uy * u0y + uz * u0z));
      const tilt = (Math.acos(dot) * 180) / Math.PI;
      if (tilt > maxTiltDeg) maxTiltDeg = tilt;
    }

    if (accelSamples <= T.WARMUP_SAMPLES) return;

    // Linear (gravity-removed) acceleration, m/s^2 — THE FIX.
    const lx = (s.ax - gx) * G;
    const ly = (s.ay - gy) * G;
    const lz = (s.az - gz) * G;

    // Strip the vertical component; what remains is in the road plane.
    const vert = lx * ux + ly * uy + lz * uz;
    const hx = lx - vert * ux;
    const hy = ly - vert * uy;
    const hz = lz - vert * uz;

    p = hx * e1x + hy * e1y + hz * e1z;
    q = hx * e2x + hy * e2y + hz * e2z;

    // Axis calibration: lateral accel correlates with yaw rate (a_lat ~ v*w).
    if (Math.abs(latestYaw) > T.AXIS_MIN_YAW_RAD) {
      Sp += p * latestYaw;
      Sq += q * latestYaw;
      axisDenom += Math.hypot(p, q) * Math.abs(latestYaw);
      axisSamples += 1;
    }
    // Third moments, for the forward/backward sign decision later.
    m3ppp += p * p * p;
    m3ppq += p * p * q;
    m3pqq += p * q * q;
    m3qqq += q * q * q;
    m3n += 1;

    // Magnitude of horizontal force. This is orientation-independent and is
    // always trustworthy — unlike its decomposition, which needs a learned axis.
    const aHorMag = Math.hypot(p, q);

    // Classify by YAW RATE rather than by the learned axis. A car generating
    // real lateral force is always yawing; one braking hard essentially isn't.
    // This separates cornering from braking with no calibration at all, which
    // matters because a short straight trip never calibrates.
    if (Math.abs(latestYaw) > T.CORNERING_YAW_RAD) {
      latHist.add(aHorMag);
      if (aHorMag > latMax) latMax = aHorMag;
      if (aHorMag > winLat) winLat = aHorMag;
      cornerDet.update(aHorMag, tMs);
      // Feed the longitudinal detectors a zero so an in-flight event closes
      // rather than spanning a corner.
      brakeDet.update(0, tMs);
      accelDet.update(0, tMs);
      prevALon = 0;
    } else {
      lonHist.add(aHorMag);
      if (aHorMag > winDecel) winDecel = aHorMag;
      cornerDet.update(0, tMs);

      // Braking vs accelerating needs to know which way is forward, which only
      // calibration can tell us. Until it does, attribute to braking: in a road
      // car, longitudinal force beyond ~3 m/s^2 is nearly always deceleration
      // (few road cars accelerate that hard), and axis_confidence is reported
      // so a consumer can see the split was assumed rather than measured.
      const { lx: dlx, ly: dly, conf } = lateralDir();
      let signedLon = -aHorMag; // assume deceleration
      if (conf >= T.AXIS_MIN_CONFIDENCE && axisSamples >= T.AXIS_MIN_SAMPLES) {
        signedLon = p * -dly + q * dlx;
      }

      brakeDet.update(-signedLon, tMs);
      accelDet.update(signedLon, tMs);

      const jerk = (signedLon - prevALon) / dt;
      lonJerkSumSq += jerk * jerk;
      lonJerkN += 1;
      prevALon = signedLon;
    }
  }

  function addGyro(s: GyroSample): void {
    const dt = clampDt(s.dtSec);
    // Yaw rate about the gravity vector — mount-invariant by construction.
    const yaw = s.gx * ux + s.gy * uy + s.gz * uz;
    latestYaw = yaw;

    if (accelSamples <= T.WARMUP_SAMPLES) {
      prevYaw = yaw;
      return;
    }

    const a = Math.abs(yaw);
    yawHist.add(a);
    if (a > yawMax) yawMax = a;
    if (a > winYaw) winYaw = a;
    if (a > peakYawSinceReversal) peakYawSinceReversal = a;

    // Schmitt trigger: only a crossing of the far deadband counts, so noise
    // around zero can't manufacture reversals.
    if (yaw > T.YAW_DEADBAND_RAD && steerState !== 1) {
      if (steerState === -1) registerReversal();
      steerState = 1;
    } else if (yaw < -T.YAW_DEADBAND_RAD && steerState !== -1) {
      if (steerState === 1) registerReversal();
      steerState = -1;
    }

    const yawJerk = (yaw - prevYaw) / dt;
    yawJerkSumSq += yawJerk * yawJerk;
    yawJerkN += 1;
    prevYaw = yaw;
  }

  function registerReversal(): void {
    reversals += 1;
    // A swerve is two reversals in quick succession, both sides sharp — the
    // lane-change-abort / obstacle-avoidance signature.
    if (
      tMs - lastReversalMs <= T.SWERVE_WINDOW_MS &&
      peakYawSinceReversal > T.SWERVE_YAW_RAD &&
      prevPeakYaw > T.SWERVE_YAW_RAD
    ) {
      swerves += 1;
    }
    lastReversalMs = tMs;
    prevPeakYaw = peakYawSinceReversal;
    peakYawSinceReversal = 0;
  }

  function closeWindow(): WindowPeaks {
    const out: WindowPeaks = {
      // Negative, matching the legacy accel_z convention for braking.
      peakDecelMs2: -winDecel,
      peakYawRateRad: winYaw,
      peakLateralMs2: winLat,
    };
    winDecel = 0; winYaw = 0; winLat = 0;
    return out;
  }

  function preview(): BehaviorPreview {
    return {
      steeringReversals: reversals,
      swerveEvents: swerves,
      harshBrakingEvents: brakeDet.count,
      harshAccelEvents: accelDet.count,
      harshCorneringEvents: cornerDet.count,
      lateralGMax: latMax / G,
    };
  }

  function finalize(durationSec: number): TripBehavior {
    brakeDet.flush();
    accelDet.flush();
    cornerDet.flush();

    const { conf } = lateralDir();
    const calibrated = conf >= T.AXIS_MIN_CONFIDENCE && axisSamples >= T.AXIS_MIN_SAMPLES;

    // Forward/backward: every road car brakes harder than it accelerates, so
    // the longitudinal distribution is skewed toward deceleration. Computed
    // from the stored third moments — no second pass needed.
    let brakeEvents = brakeDet.count;
    let accelEvents = accelDet.count;
    let avgDecel = brakeDet.avgPeak;
    let avgAccel = accelDet.avgPeak;
    let maxDecel = brakeDet.maxPeak;
    if (calibrated && m3n > 0) {
      const { lx, ly } = lateralDir();
      const a = -ly, b = lx; // longitudinal direction
      const skew =
        (a * a * a * m3ppp + 3 * a * a * b * m3ppq + 3 * a * b * b * m3pqq + b * b * b * m3qqq) / m3n;
      if (skew > 0) {
        // We had forward backwards: swap the two directional tallies.
        [brakeEvents, accelEvents] = [accelEvents, brakeEvents];
        [avgDecel, avgAccel] = [avgAccel, avgDecel];
        maxDecel = accelDet.maxPeak;
      }
    }

    const minutes = Math.max(durationSec, 1) / 60;
    const mountStable = maxTiltDeg <= T.MOUNT_MAX_TILT_DEG;

    if (!calibrated) {
      console.log(
        `[DriverBehavior] forward axis not established (confidence ${conf.toFixed(2)}, ` +
          `${axisSamples} turning samples) - braking and acceleration are not separated`
      );
    }
    if (!mountStable) {
      console.log(
        `[DriverBehavior] mount moved ${maxTiltDeg.toFixed(0)}deg during the trip - ` +
          `treat directional metrics with suspicion`
      );
    }

    return {
      steering_reversal_rate: reversals / minutes,
      steering_smoothness_index: yawJerkN > 0 ? Math.sqrt(yawJerkSumSq / yawJerkN) : 0,
      swerve_events: swerves,
      yaw_rate_p95: yawHist.percentile(0.95),
      yaw_rate_max: yawMax,

      harsh_braking_events: brakeEvents,
      harsh_accel_events: accelEvents,
      avg_decel_intensity: avgDecel,
      avg_accel_intensity: avgAccel,
      max_decel_ms2: maxDecel,
      longitudinal_jerk_rms: lonJerkN > 0 ? Math.sqrt(lonJerkSumSq / lonJerkN) : 0,

      harsh_cornering_events: cornerDet.count,
      lateral_g_max: latMax / G,
      lateral_g_p95: latHist.percentile(0.95) / G,

      imu_sample_count: accelSamples,
      mount_stable: mountStable,
      axis_confidence: conf,
      sensor_dropout_sec: dropoutSec,
      synthetic_obd_count: 0, // the trip recorder fills this in; it owns the count
    };
  }

  return { addAccel, addGyro, closeWindow, preview, finalize };
}
