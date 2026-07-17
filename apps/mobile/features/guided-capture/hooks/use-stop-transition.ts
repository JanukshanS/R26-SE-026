import { Gyroscope } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';

import {
  GYRO_NOISE_DEADBAND_RAD_S,
  GYRO_UPDATE_INTERVAL_MS,
} from '@/features/guided-capture/constants';
import { addGyroscopeListener } from './sensor-compat';

export type UseStopTransitionOptions = {
  /** True only while the user should be walking to the next stop. */
  enabled: boolean;
  /** Angular walk target in degrees. */
  targetDeg: number;
  /** Fires once, the moment the accumulated walked angle reaches targetDeg. */
  onTargetReached: () => void;
};

export type UseStopTransitionResult = {
  /** Accumulated angle / targetDeg, clamped 0..1. */
  progress01: number;
};

const MAX_SAMPLE_DT_SEC = 0.5;

/**
 * Measures how far the user has walked (in degrees of yaw) since `enabled` became true,
 * by integrating gyroscope rotation rate over time — no compass/GPS/vision involved.
 * Fires onTargetReached once the accumulated angle crosses targetDeg.
 */
export function useStopTransition({
  enabled,
  targetDeg,
  onTargetReached,
}: UseStopTransitionOptions): UseStopTransitionResult {
  const [progress01, setProgress01] = useState(0);

  const accumulatedDegRef = useRef(0);
  const lastSampleAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const onTargetReachedRef = useRef(onTargetReached);
  onTargetReachedRef.current = onTargetReached;

  useEffect(() => {
    Gyroscope.setUpdateInterval(GYRO_UPDATE_INTERVAL_MS);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    accumulatedDegRef.current = 0;
    lastSampleAtRef.current = null;
    firedRef.current = false;
    setProgress01(0);

    const sub = addGyroscopeListener((data) => {
      if (firedRef.current) {
        return;
      }
      const now = Date.now();
      const last = lastSampleAtRef.current;
      lastSampleAtRef.current = now;
      if (last == null) {
        return;
      }
      const dt = Math.min((now - last) / 1000, MAX_SAMPLE_DT_SEC);
      if (dt <= 0) {
        return;
      }

      // Phone held upright/portrait facing the user while walking (same assumption as the
      // pose screens) — rotation around the screen-normal axis approximates yaw around the
      // vertical axis while turning to walk around the vehicle.
      const rateRadPerSec = Math.abs(data.z ?? 0);
      if (rateRadPerSec < GYRO_NOISE_DEADBAND_RAD_S) {
        return;
      }

      accumulatedDegRef.current += rateRadPerSec * dt * (180 / Math.PI);
      const next = Math.min(1, accumulatedDegRef.current / targetDeg);
      setProgress01(next);

      if (accumulatedDegRef.current >= targetDeg && !firedRef.current) {
        firedRef.current = true;
        onTargetReachedRef.current();
      }
    });

    return () => sub.remove();
  }, [enabled, targetDeg]);

  return { progress01 };
}
