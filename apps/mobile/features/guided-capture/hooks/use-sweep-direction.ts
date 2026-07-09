import { useCallback, useEffect, useRef, useState } from 'react';
import { SWEEP_INFER_MIN_YAW_DEG } from '@/features/guided-capture/constants';
import { shortestAngleDeltaDeg } from '@/features/guided-capture/sweep-geometry';
import type { CaptureAngle } from '@/features/guided-capture/types';

export type UseSweepDirectionResult = {
  sweepDirection: 'left' | 'right' | null;
  chooseSweepDirection: (direction: 'left' | 'right') => void;
  /** Resets to the persisted preset (URL param or user modal choice). Call on capture reset. */
  resetSweepDirection: () => void;
};

export function useSweepDirection(
  capturedAngles: CaptureAngle[],
  currentYaw: number,
  initialSweepDirection: 'left' | 'right' | null,
  isStoreHydrated: boolean
): UseSweepDirectionResult {
  const [sweepDirection, setSweepDirection] = useState<'left' | 'right' | null>(null);
  const persistedPresetRef = useRef<'left' | 'right' | null>(initialSweepDirection);
  const presetAppliedRef = useRef(false);
  const initialRef = useRef(initialSweepDirection);
  initialRef.current = initialSweepDirection;

  // Apply URL/modal preset only after the store has loaded and no captures exist yet.
  useEffect(() => {
    if (!isStoreHydrated) return;
    if (capturedAngles.length > 0) return;
    const preset = initialRef.current;
    if (preset !== 'left' && preset !== 'right') return;
    if (presetAppliedRef.current) return;
    persistedPresetRef.current = preset;
    setSweepDirection(preset);
    presetAppliedRef.current = true;
  }, [isStoreHydrated, capturedAngles]);

  // Infer direction from yaw delta after the first capture.
  useEffect(() => {
    if (sweepDirection !== null) return;
    if (capturedAngles.length !== 1) return;
    const first = capturedAngles[0];
    const delta = shortestAngleDeltaDeg(first.yaw, currentYaw);
    if (Math.abs(delta) >= SWEEP_INFER_MIN_YAW_DEG) {
      setSweepDirection(delta >= 0 ? 'right' : 'left');
    }
  }, [capturedAngles, sweepDirection, currentYaw]);

  const chooseSweepDirection = useCallback(
    (direction: 'left' | 'right') => {
      if (capturedAngles.length > 0) return;
      persistedPresetRef.current = direction;
      setSweepDirection(direction);
      presetAppliedRef.current = true;
    },
    [capturedAngles.length]
  );

  const resetSweepDirection = useCallback(() => {
    const preset = persistedPresetRef.current;
    setSweepDirection(preset === 'left' || preset === 'right' ? preset : null);
    presetAppliedRef.current = preset === 'left' || preset === 'right';
  }, []);

  return { sweepDirection, chooseSweepDirection, resetSweepDirection };
}
