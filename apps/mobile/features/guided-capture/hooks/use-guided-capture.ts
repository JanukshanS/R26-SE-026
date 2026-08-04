import type { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import {
  CAPTURE_STABILITY_HOLD_MS,
  DEFAULT_STOP_COUNT,
  SENSOR_LOW_FREQ_INTERVAL_MS,
  SENSOR_SMOOTHING_ALPHA,
} from '@/features/guided-capture/constants';
import { addAccelerometerListener } from './sensor-compat';
import {
  deleteGuidedCapturePhotos,
  loadGuidedCaptureStoreState,
  persistCapturedPhoto,
  saveGuidedCaptureStoreState,
} from '@/features/guided-capture/storage/guided-capture-store';
import { isTiltAligned, tiltHintFor } from '@/features/guided-capture/tilt-status';
import { HEIGHT_STEPS, type HeightStep, type StopPhoto } from '@/features/guided-capture/types';
import { clearAllClaimData } from '@/lib/clear-claim-data';
import { deletePhotoGpsEntries } from '@/lib/photo-gps-store';
import { snapAndSavePhotoGps } from '@/lib/snap-photo-gps';

export type FlowPhase =
  | { kind: 'posing'; stopIndex: number; heightStep: HeightStep }
  | { kind: 'aiming'; stopIndex: number; heightStep: HeightStep }
  | { kind: 'moveNext'; completedStopIndex: number };

type UseGuidedCaptureResult = {
  phase: FlowPhase;
  photos: StopPhoto[];
  photosByStop: Map<number, StopPhoto[]>;
  stopCount: number;
  totalPhotosExpected: number;
  isRetake: boolean;
  pitchDeg: number;
  tiltAligned: boolean;
  shutterUnlocked: boolean;
  isCapturing: boolean;
  statusMessage: string;
  captureButtonLabel: string;
  onCapture: () => Promise<void>;
  onPoseReady: () => void;
  onMoveNextConfirmed: () => void;
  onRetake: (stopIndex: number, heightStep: HeightStep) => void;
  onDeleteStop: (stopIndex: number) => void;
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  resetEnabled: boolean;
  onResetCapture: () => void;
  isResetDialogVisible: boolean;
  onCancelResetDialog: () => void;
  onConfirmResetDialog: () => void;
  isPreviewVisible: boolean;
  submitEnabled: boolean;
  onSubmitPhotos: () => void;
  onClosePreview: () => void;
  isStoreHydrated: boolean;
};

export type UseGuidedCaptureOptions = {
  stopCount?: number;
};

const INITIAL_PHASE: FlowPhase = { kind: 'posing', stopIndex: 0, heightStep: HEIGHT_STEPS[0] };

function findNextIncompleteSlot(
  photos: StopPhoto[],
  stopCount: number
): { stopIndex: number; heightStep: HeightStep } | null {
  const captured = new Set(photos.map((p) => `${p.stopIndex}-${p.heightStep}`));
  for (let s = 0; s < stopCount; s++) {
    for (const h of HEIGHT_STEPS) {
      if (!captured.has(`${s}-${h}`)) {
        return { stopIndex: s, heightStep: h };
      }
    }
  }
  return null;
}

/** Where to resume posing given the current photos — first incomplete required slot, or
 * the next extra stop past whatever's already captured if all required slots are filled. */
function computeResumePhase(photos: StopPhoto[], stopCount: number): FlowPhase {
  const next = findNextIncompleteSlot(photos, stopCount);
  if (next) {
    return { kind: 'posing', stopIndex: next.stopIndex, heightStep: next.heightStep };
  }
  const maxStopIndex = photos.reduce((m, p) => Math.max(m, p.stopIndex), stopCount - 1);
  return { kind: 'posing', stopIndex: maxStopIndex + 1, heightStep: HEIGHT_STEPS[0] };
}

export function useGuidedCapture(
  cameraRef: RefObject<CameraView | null>,
  options: UseGuidedCaptureOptions = {}
): UseGuidedCaptureResult {
  const stopCount = options.stopCount ?? DEFAULT_STOP_COUNT;

  const [pitchDeg, setPitchDeg] = useState(0);
  const [phase, setPhase] = useState<FlowPhase>(INITIAL_PHASE);
  const [photos, setPhotos] = useState<StopPhoto[]>([]);
  const [retakeTarget, setRetakeTarget] = useState<{ stopIndex: number; heightStep: HeightStep } | null>(
    null
  );
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Align camera and hold steady.');
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [isResetDialogVisible, setIsResetDialogVisible] = useState(false);
  const [isStoreHydrated, setIsStoreHydrated] = useState(false);

  const sensorFilterRef = useRef({ pitch: 0, hasSample: false });
  const captureGuardRef = useRef({ shutterUnlocked: false, isCapturing: false });
  const hydratedStoreRef = useRef(false);

  // Mirrors of the latest state, read at call time inside imperative handlers
  // (rather than inside setState updaters, which must stay pure).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const retakeTargetRef = useRef(retakeTarget);
  retakeTargetRef.current = retakeTarget;

  useEffect(() => {
    Accelerometer.setUpdateInterval(SENSOR_LOW_FREQ_INTERVAL_MS);
    const α = SENSOR_SMOOTHING_ALPHA;
    const sub = addAccelerometerListener((data) => {
      const y = data.y ?? 0;
      const z = data.z ?? 0;
      // Portrait-held forward/backward tilt: 0° upright, larger magnitude = tipped forward/down.
      const raw = Math.atan2(z, y) * (180 / Math.PI);
      const f = sensorFilterRef.current;
      if (!f.hasSample) {
        f.pitch = raw;
        f.hasSample = true;
      } else {
        f.pitch = α * raw + (1 - α) * f.pitch;
      }
      setPitchDeg(f.pitch);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await loadGuidedCaptureStoreState();
        if (cancelled) return;
        setPhotos(state.photos);
        setPhase(computeResumePhase(state.photos, stopCount));
        hydratedStoreRef.current = true;
      } finally {
        if (!cancelled) {
          setIsStoreHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stopCount]);

  useEffect(() => {
    if (!hydratedStoreRef.current) {
      return;
    }
    void saveGuidedCaptureStoreState({ photos });
  }, [photos]);

  const currentHeightStep = phase.kind === 'aiming' ? phase.heightStep : null;
  const tiltAligned = currentHeightStep != null && isTiltAligned(pitchDeg, currentHeightStep);
  const shutterUnlocked = tiltAligned && !isCapturing;

  captureGuardRef.current.shutterUnlocked = shutterUnlocked;
  captureGuardRef.current.isCapturing = isCapturing;

  useEffect(() => {
    setStatusMessage(
      currentHeightStep
        ? shutterUnlocked
          ? 'Angle is good — capture now.'
          : tiltHintFor(pitchDeg, currentHeightStep)
        : ''
    );
  }, [currentHeightStep, shutterUnlocked, pitchDeg]);

  const captureButtonLabel = useMemo(() => {
    if (isCapturing) return 'Capturing';
    if (shutterUnlocked) return 'Take Photo';
    if (currentHeightStep) return tiltHintFor(pitchDeg, currentHeightStep);
    return 'Take Photo';
  }, [isCapturing, shutterUnlocked, currentHeightStep, pitchDeg]);

  const onPoseReady = useCallback(() => {
    setPhase((prev) =>
      prev.kind === 'posing'
        ? { kind: 'aiming', stopIndex: prev.stopIndex, heightStep: prev.heightStep }
        : prev
    );
  }, []);

  const onCaptured = useCallback(
    async (tempUri: string, capturedAtIso: string) => {
      const current = phaseRef.current;
      if (current.kind !== 'aiming') {
        return;
      }
      const { stopIndex, heightStep } = current;

      let storedUri = tempUri;
      try {
        storedUri = await persistCapturedPhoto(tempUri);
      } catch {
        storedUri = tempUri;
      }
      void snapAndSavePhotoGps(storedUri, capturedAtIso);

      setPhotos((list) => {
        const withoutExisting = list.filter(
          (p) => !(p.stopIndex === stopIndex && p.heightStep === heightStep)
        );
        return [...withoutExisting, { stopIndex, heightStep, uri: storedUri, capturedAtIso }];
      });

      if (retakeTargetRef.current) {
        setRetakeTarget(null);
        setIsPreviewVisible(true);
        return;
      }

      const heightIdx = HEIGHT_STEPS.indexOf(heightStep);
      const nextHeight = HEIGHT_STEPS[heightIdx + 1];
      if (nextHeight) {
        setPhase({ kind: 'posing', stopIndex, heightStep: nextHeight });
        return;
      }
      // Keep going past the required stopCount rather than dead-ending into review —
      // any further stops are "extra" and get added (never overwrite), reviewable in
      // View Images like the rest.
      setPhase({ kind: 'moveNext', completedStopIndex: stopIndex });
    },
    []
  );

  const runCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || captureGuardRef.current.isCapturing || !captureGuardRef.current.shutterUnlocked) {
      return;
    }
    try {
      setIsCapturing(true);
      const capturedAtIso = new Date().toISOString();
      const photo = await cam.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
      if (photo?.uri) {
        await onCaptured(photo.uri, capturedAtIso);
      }
    } catch {
      setStatusMessage('Capture failed. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [cameraRef, onCaptured]);

  // Auto mode: hold steady on a green tilt for CAPTURE_STABILITY_HOLD_MS, then buzz + capture.
  useEffect(() => {
    if (!shutterUnlocked || !autoCaptureEnabled) {
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await runCapture();
      })();
    }, CAPTURE_STABILITY_HOLD_MS);
    return () => clearTimeout(timer);
  }, [shutterUnlocked, autoCaptureEnabled, runCapture]);

  const onMoveNextConfirmed = useCallback(() => {
    setPhase((prev) => {
      if (prev.kind !== 'moveNext') {
        return prev;
      }
      return { kind: 'posing', stopIndex: prev.completedStopIndex + 1, heightStep: HEIGHT_STEPS[0] };
    });
  }, []);

  const onRetake = useCallback((stopIndex: number, heightStep: HeightStep) => {
    setRetakeTarget({ stopIndex, heightStep });
    setIsPreviewVisible(false);
    setPhase({ kind: 'posing', stopIndex, heightStep });
  }, []);

  const onDeleteStop = useCallback(
    (stopIndex: number) => {
      setPhotos((list) => {
        const toDelete = list.filter((p) => p.stopIndex === stopIndex);
        if (toDelete.length === 0) {
          return list;
        }
        const uris = toDelete.map((p) => p.uri);
        void deleteGuidedCapturePhotos(uris);
        void deletePhotoGpsEntries(uris);
        const remaining = list.filter((p) => p.stopIndex !== stopIndex);
        // Deleting a stop can leave `phase` pointing at a slot that no longer has (or never
        // had) photos backing it — e.g. deleting every stop down to 0 while phase was still
        // sitting on stop 13 from an earlier "extra" stop. Recompute where to resume instead
        // of leaving it stale.
        setPhase(computeResumePhase(remaining, stopCount));
        return remaining;
      });
    },
    [stopCount]
  );

  const resetEnabled = photos.length > 0;

  const onResetCapture = () => {
    if (!resetEnabled) return;
    setIsResetDialogVisible(true);
  };

  const onCancelResetDialog = () => setIsResetDialogVisible(false);

  const onConfirmResetDialog = () => {
    setIsResetDialogVisible(false);
    setPhotos([]);
    setRetakeTarget(null);
    setIsPreviewVisible(false);
    setPhase(INITIAL_PHASE);
    setStatusMessage('Capture reset. Previous photos cleared.');
    // Resets every claim step (Guided Capture, Driving Licence, User Verification, 3rd Party),
    // not just this one — Reset here is a full "start this claim over" action.
    void clearAllClaimData();
  };

  const submitEnabled = photos.length >= 1 && !isCapturing;

  const onSubmitPhotos = () => {
    if (!submitEnabled) return;
    setIsPreviewVisible(true);
  };

  const onClosePreview = () => setIsPreviewVisible(false);

  const photosByStop = useMemo(() => {
    const map = new Map<number, StopPhoto[]>();
    for (const photo of photos) {
      const list = map.get(photo.stopIndex) ?? [];
      list.push(photo);
      map.set(photo.stopIndex, list);
    }
    return map;
  }, [photos]);

  const totalPhotosExpected = stopCount * HEIGHT_STEPS.length;

  return {
    phase,
    photos,
    photosByStop,
    stopCount,
    totalPhotosExpected,
    isRetake: retakeTarget != null,
    pitchDeg,
    tiltAligned,
    shutterUnlocked,
    isCapturing,
    statusMessage,
    captureButtonLabel,
    onCapture: runCapture,
    onPoseReady,
    onMoveNextConfirmed,
    onRetake,
    onDeleteStop,
    autoCaptureEnabled,
    onToggleAutoCapture: () => setAutoCaptureEnabled((v) => !v),
    resetEnabled,
    onResetCapture,
    isResetDialogVisible,
    onCancelResetDialog,
    onConfirmResetDialog,
    isPreviewVisible,
    submitEnabled,
    onSubmitPhotos,
    onClosePreview,
    isStoreHydrated,
  };
}
