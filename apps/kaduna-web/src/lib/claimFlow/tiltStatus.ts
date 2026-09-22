import type { HeightStep } from "./types";

/** Same thresholds as apps/mobile/features/guided-capture/constants.ts, kept in
 * sync by hand — the two apps share no code. */
export const OVERHEAD_TILT_MIN_DEG = 30;
export const OVERHEAD_TILT_MAX_DEG = 50;
export const VERTICAL_TILT_TOLERANCE_DEG = 12;

export function isTiltAligned(pitchDeg: number, heightStep: HeightStep): boolean {
  if (heightStep === "overhead") {
    const abs = Math.abs(pitchDeg);
    return abs >= OVERHEAD_TILT_MIN_DEG && abs <= OVERHEAD_TILT_MAX_DEG;
  }
  return Math.abs(pitchDeg) <= VERTICAL_TILT_TOLERANCE_DEG;
}

export type TiltHint = "good" | "downMore" | "upALittle" | "upright";

export function tiltHintFor(pitchDeg: number, heightStep: HeightStep): TiltHint {
  if (isTiltAligned(pitchDeg, heightStep)) return "good";
  if (heightStep === "overhead") {
    return Math.abs(pitchDeg) < OVERHEAD_TILT_MIN_DEG ? "downMore" : "upALittle";
  }
  return "upright";
}
