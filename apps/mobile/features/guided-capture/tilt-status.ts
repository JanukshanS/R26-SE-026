import {
  OVERHEAD_TILT_MAX_DEG,
  OVERHEAD_TILT_MIN_DEG,
  VERTICAL_TILT_TOLERANCE_DEG,
} from '@/features/guided-capture/constants';
import type { HeightStep } from '@/features/guided-capture/types';
import type { Translate } from '@/lib/i18n';

export function isTiltAligned(pitchDeg: number, heightStep: HeightStep): boolean {
  if (heightStep === 'overhead') {
    const abs = Math.abs(pitchDeg);
    return abs >= OVERHEAD_TILT_MIN_DEG && abs <= OVERHEAD_TILT_MAX_DEG;
  }
  return Math.abs(pitchDeg) <= VERTICAL_TILT_TOLERANCE_DEG;
}

export function tiltHintFor(pitchDeg: number, heightStep: HeightStep, t: Translate): string {
  if (isTiltAligned(pitchDeg, heightStep)) {
    return t('insurance.capture.tiltGood');
  }
  if (heightStep === 'overhead') {
    return Math.abs(pitchDeg) < OVERHEAD_TILT_MIN_DEG
      ? t('insurance.capture.tiltDownMore')
      : t('insurance.capture.tiltUpALittle');
  }
  return t('insurance.capture.tiltUpright');
}

export type CaptureStatus = 'aligning' | 'almost' | 'steady';

/** Degrees of tilt error under which "aligning" becomes "almost" (pulsing) before going green. */
const ALMOST_MARGIN_DEG = 8;

/** Presentational-only mapping of pitchDeg/heightStep onto the 3-state StatusPill signal. */
export function captureStatusFor(pitchDeg: number, heightStep: HeightStep): CaptureStatus {
  if (isTiltAligned(pitchDeg, heightStep)) {
    return 'steady';
  }
  const abs = Math.abs(pitchDeg);
  const errorDeg =
    heightStep === 'overhead'
      ? Math.min(Math.abs(abs - OVERHEAD_TILT_MIN_DEG), Math.abs(abs - OVERHEAD_TILT_MAX_DEG))
      : abs - VERTICAL_TILT_TOLERANCE_DEG;
  return errorDeg <= ALMOST_MARGIN_DEG ? 'almost' : 'aligning';
}
