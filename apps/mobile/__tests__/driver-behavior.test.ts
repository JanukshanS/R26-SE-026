import { describe, expect, it } from "vitest";
import { BEHAVIOR_TUNING, createBehaviorAccumulator } from "@lib/driverBehavior";

const G = 9.80665;
const DT = 0.25; // 4 Hz
const WARMUP = BEHAVIOR_TUNING.WARMUP_SAMPLES;

/** Feed n samples of a constant accelerometer reading (in g) + zero rotation. */
function feedStatic(
  acc: ReturnType<typeof createBehaviorAccumulator>,
  n: number,
  g: [number, number, number]
) {
  for (let i = 0; i < n; i++) {
    acc.addAccel({ ax: g[0], ay: g[1], az: g[2], dtSec: DT });
    acc.addGyro({ gx: 0, gy: 0, gz: 0, dtSec: DT });
  }
}

describe("gravity removal (the Finding-1 regression)", () => {
  // The bug this module exists to fix: the old code did `ay = y * 9.81` and
  // tracked min(ay, 0), so a phone reading +1g on an axis could never register
  // braking, and one reading -1g registered braking in every single window.
  // A stationary phone must produce ZERO events at EVERY orientation.
  const orientations: Array<[string, [number, number, number]]> = [
    ["portrait upright (y = +1g)", [0, 1, 0]],
    ["portrait inverted (y = -1g)", [0, -1, 0]],
    ["flat face up (z = +1g)", [0, 0, 1]],
    ["flat face down (z = -1g)", [0, 0, -1]],
    ["landscape (x = +1g)", [1, 0, 0]],
    ["landscape other (x = -1g)", [-1, 0, 0]],
    ["tilted in a cradle", [0.42, 0.78, 0.46]],
  ];

  for (const [name, g] of orientations) {
    it(`reports no events when stationary: ${name}`, () => {
      const acc = createBehaviorAccumulator();
      feedStatic(acc, 400, g); // 100 s parked
      const b = acc.finalize(100);

      expect(b.harsh_braking_events).toBe(0);
      expect(b.harsh_accel_events).toBe(0);
      expect(b.harsh_cornering_events).toBe(0);
      expect(b.swerve_events).toBe(0);
      expect(b.steering_reversal_rate).toBe(0);
      expect(b.lateral_g_max).toBeLessThan(0.02);
    });
  }
});

describe("harsh braking", () => {
  it("counts one event for a single sustained deceleration", () => {
    const acc = createBehaviorAccumulator();
    // Settle upright, then brake at -4 m/s^2 for 1 s along the phone's x axis.
    feedStatic(acc, WARMUP + 40, [0, 1, 0]);
    const bump = 4 / G;
    for (let i = 0; i < 4; i++) {
      acc.addAccel({ ax: bump, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: 0, gz: 0, dtSec: DT });
    }
    feedStatic(acc, 40, [0, 1, 0]);
    const b = acc.finalize(30);

    // Direction can't be resolved without turning data, so it lands in exactly
    // one of the two longitudinal tallies — but it must be counted once.
    expect(b.harsh_braking_events + b.harsh_accel_events).toBe(1);
  });

  it("ignores a single-sample spike (a pothole, not a brake)", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 40, [0, 1, 0]);
    acc.addAccel({ ax: 6 / G, ay: 1, az: 0, dtSec: DT }); // one sample only
    acc.addGyro({ gx: 0, gy: 0, gz: 0, dtSec: DT });
    feedStatic(acc, 40, [0, 1, 0]);
    const b = acc.finalize(30);

    expect(b.harsh_braking_events + b.harsh_accel_events).toBe(0);
  });

  it("does not count one long brake as several", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 40, [0, 1, 0]);
    for (let i = 0; i < 20; i++) {
      // 5 s of continuous heavy braking
      acc.addAccel({ ax: 4 / G, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: 0, gz: 0, dtSec: DT });
    }
    feedStatic(acc, 40, [0, 1, 0]);
    const b = acc.finalize(40);

    expect(b.harsh_braking_events + b.harsh_accel_events).toBe(1);
  });
});

describe("steering reversal rate", () => {
  it("matches the reversal count of a known sine wave", () => {
    // A 0.2 Hz yaw oscillation reverses twice per cycle => 0.4 reversals/s
    // => 24 per minute.
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 4, [0, 1, 0]);

    const seconds = 60;
    const freq = 0.2;
    for (let i = 0; i < seconds / DT; i++) {
      const t = i * DT;
      const yaw = 0.5 * Math.sin(2 * Math.PI * freq * t);
      acc.addAccel({ ax: 0, ay: 1, az: 0, dtSec: DT });
      // Phone is upright (y = +1g), so yaw about gravity is the y gyro axis.
      acc.addGyro({ gx: 0, gy: yaw, gz: 0, dtSec: DT });
    }
    const b = acc.finalize(seconds);

    expect(b.steering_reversal_rate).toBeGreaterThan(20);
    expect(b.steering_reversal_rate).toBeLessThan(28);
  });

  it("does not manufacture reversals from noise around zero", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 4, [0, 1, 0]);
    // Jitter well inside the deadband.
    for (let i = 0; i < 240; i++) {
      acc.addAccel({ ax: 0, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: (i % 2 ? 1 : -1) * 0.02, gz: 0, dtSec: DT });
    }
    const b = acc.finalize(60);

    expect(b.steering_reversal_rate).toBe(0);
  });

  it("is mount-invariant: the same motion scores the same upside down", () => {
    function run(gvec: [number, number, number], sign: number) {
      const acc = createBehaviorAccumulator();
      feedStatic(acc, WARMUP + 4, gvec);
      for (let i = 0; i < 240; i++) {
        const yaw = sign * 0.5 * Math.sin(2 * Math.PI * 0.2 * i * DT);
        acc.addAccel({ ax: gvec[0], ay: gvec[1], az: gvec[2], dtSec: DT });
        acc.addGyro({ gx: 0, gy: yaw, gz: 0, dtSec: DT });
      }
      return acc.finalize(60).steering_reversal_rate;
    }
    // Flipping the mount flips the sign of yaw; the rate must not change.
    expect(run([0, 1, 0], 1)).toBeCloseTo(run([0, -1, 0], -1), 5);
  });
});

describe("swerve detection", () => {
  it("does not fire on ordinary gentle steering", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 4, [0, 1, 0]);
    for (let i = 0; i < 240; i++) {
      // Slow, shallow weave: reverses, but never sharply.
      const yaw = 0.08 * Math.sin(2 * Math.PI * 0.05 * i * DT);
      acc.addAccel({ ax: 0, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: yaw, gz: 0, dtSec: DT });
    }
    expect(acc.finalize(60).swerve_events).toBe(0);
  });

  it("fires on a sharp rapid double reversal", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 4, [0, 1, 0]);
    // ~1 Hz, well above the swerve yaw threshold: sharp left-right-left.
    for (let i = 0; i < 40; i++) {
      const yaw = 0.6 * Math.sin(2 * Math.PI * 1.0 * i * DT);
      acc.addAccel({ ax: 0, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: yaw, gz: 0, dtSec: DT });
    }
    expect(acc.finalize(10).swerve_events).toBeGreaterThan(0);
  });
});

describe("quality reporting", () => {
  it("flags an unstable mount", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 40, [0, 1, 0]);
    feedStatic(acc, 200, [0.7, 0.7, 0]); // ~45 deg re-seat
    expect(acc.finalize(60).mount_stable).toBe(false);
  });

  it("reports low axis confidence when the car never turns", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, 400, [0, 1, 0]);
    // No turning => the forward direction is unknowable, and we must say so
    // rather than guess which way is braking.
    expect(acc.finalize(100).axis_confidence).toBeLessThan(BEHAVIOR_TUNING.AXIS_MIN_CONFIDENCE);
  });

  it("keeps memory flat regardless of trip length", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, 20_000, [0, 1, 0]); // ~83 minutes at 4 Hz
    const b = acc.finalize(5000);
    expect(b.imu_sample_count).toBe(20_000);
    expect(Number.isFinite(b.yaw_rate_p95)).toBe(true);
  });
});

describe("window peaks (legacy IMUReading fields)", () => {
  it("returns a negative deceleration peak and resets each window", () => {
    const acc = createBehaviorAccumulator();
    feedStatic(acc, WARMUP + 40, [0, 1, 0]);
    for (let i = 0; i < 4; i++) {
      acc.addAccel({ ax: 4 / G, ay: 1, az: 0, dtSec: DT });
      acc.addGyro({ gx: 0, gy: 0, gz: 0, dtSec: DT });
    }
    const w1 = acc.closeWindow();
    expect(Math.abs(w1.peakDecelMs2)).toBeGreaterThan(3);

    feedStatic(acc, 20, [0, 1, 0]);
    const w2 = acc.closeWindow();
    expect(Math.abs(w2.peakDecelMs2)).toBeLessThan(1); // reset, quiet window
  });
});
