import {
  OVERHEAD_TILT_MAX_DEG,
  OVERHEAD_TILT_MIN_DEG,
  VERTICAL_TILT_TOLERANCE_DEG,
} from '@/features/guided-capture/constants';
import type { HeightStep } from '@/features/guided-capture/types';

export function isTiltAligned(pitchDeg: number, heightStep: HeightStep): boolean {
  if (heightStep === 'overhead') {
    const abs = Math.abs(pitchDeg);
    return abs >= OVERHEAD_TILT_MIN_DEG && abs <= OVERHEAD_TILT_MAX_DEG;
  }
  return Math.abs(pitchDeg) <= VERTICAL_TILT_TOLERANCE_DEG;
}

export function tiltHintFor(pitchDeg: number, heightStep: HeightStep): string {
  if (isTiltAligned(pitchDeg, heightStep)) {
    return 'Tilt: good';
  }
  if (heightStep === 'overhead') {
    return Math.abs(pitchDeg) < OVERHEAD_TILT_MIN_DEG
      ? 'Tilt the phone down more'
      : 'Tilt the phone up a little';
  }
  return 'Hold the phone upright';
}
