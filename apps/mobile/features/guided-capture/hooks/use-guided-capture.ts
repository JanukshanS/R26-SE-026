import type { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addAccelerometerListener, addGyroscopeListener, addMagnetometerListener } from './sensor-compat';
import type { RefObject } from 'react';
import {
  DIRECTION_REVERSAL_TOLERANCE_DEG,
  GYRO_Z_DEADBAND_RAD_S,
  HEADING_MAG_ANOMALY_CAP_DEG,
  HEADING_MAG_FUSION_GAIN,
  HEADING_MAG_VECTOR_SMOOTH_ALPHA,
  MAX_FLAT_Z_COMPONENT,
  MAX_GYRO_SPEED_RAD,
  MAX_OVERLAP_STEP_DEG,
  MAX_VERTICAL_PITCH_DELTA_DEG,
  MIN_OVERLAP_STEP_DEG,
  MIN_PHOTOS,
  MOTION_BAR_FILL_TARGET_PERCENT,
  OVERLAP_PROGRESS_REFERENCE_DEG,
  OVERLAP_TARGET_PERCENT,
  SENSOR_LOW_FREQ_INTERVAL_MS,
  SENSOR_SMOOTHING_ALPHA,
  GYROSCOPE_UPDATE_INTERVAL_MS,
  SWEEP_INFER_MIN_YAW_DEG,
  AUTO_CAPTURE_AFTER_HAPTIC_MS,
} from '@/features/guided-capture/constants';
import {
  evaluateGuidedCaptureState,
  type GuidedCaptureInvalidReason,
  type GuidedCaptureState,
} from '@/features/guided-capture/guided-capture-machine';
import {
  deleteGuidedCapturePhotos,
  loadGuidedCaptureStoreState,
  persistCapturedPhoto,
  saveGuidedCaptureStoreState,
} from '@/features/guided-capture/storage/guided-capture-store';
import {
  headingDegFromHorizontalMag,
  tiltCompensatedHorizontalMag,
} from '@/features/guided-capture/sensor-heading';
import { shortestAngleDeltaDeg } from '@/features/guided-capture/sweep-geometry';
import { prepareImageForZeroDce } from '@/features/low-light/prepare-image-for-zero-dce';
import { clearPersistedClaimUploadSuccess } from '@/lib/claim-upload-dedupe';
import { clearInsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { clearGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { clearReportAccidentEntryMeta } from '@/features/report-accident/storage/report-accident-entry-store';
import type { CaptureAngle } from '@/features/guided-capture/types';

type UseGuidedCaptureResult = {
  capturedCount: number;
  capturedPhotoUris: string[];
  /** Photo count / MIN_PHOTOS (legacy; chip still uses counts). */
  progressRatio: number;
  /** 0–1 fill toward motion-bar target (see MOTION_BAR_FILL_TARGET_PERCENT) or direction-lock. */
  motionBarFill01: number;
  /** True when overlap reaches motion-bar target (bar turns green); capture haptic may still use a higher %. */
  motionBarComplete: boolean;
  /** True = fill grows from the left; false = from the right (left sweep). */
  motionBarAnchorStart: boolean;
  motionBarCaption: string;
  overlapGuideOffsetPx: number;
  overlapGuideProgressPct: number;
  isVerticalMovementWithinLimit: boolean;
  isDirectionValid: boolean;
  sweepDirection: 'left' | 'right' | null;
  captureState: GuidedCaptureState;
  invalidReason: GuidedCaptureInvalidReason | null;
  isUprightForCapture: boolean;
  shutterUnlocked: boolean;
  /** True when "View Images" can open (≥1 photo, not mid-capture). */
  submitEnabled: boolean;
  statusMessage: string;
  isPreviewVisible: boolean;
  onCapture: () => Promise<void>;
  onSubmitPhotos: () => void;
  onResetCapture: () => void;
  onClosePreview: () => void;
  captureButtonLabel: string;
  /** When true, overlap-target haptic is followed by auto capture (2nd photo onward). */
  autoCaptureEnabled: boolean;
  onToggleAutoCapture: () => void;
  resetEnabled: boolean;
  isResetDialogVisible: boolean;
  onCancelResetDialog: () => void;
  onConfirmResetDialog: () => void;
  /** True after guided-capture store has loaded from disk (safe to show sweep modal). */
  isStoreHydrated: boolean;
  /** Call when user picks sweep in the direction modal (no URL preset). */
  chooseSweepDirection: (direction: 'left' | 'right') => void;
};

export type UseGuidedCaptureOptions = {
  /** From URL `?sweep=` or preset after user picks direction in modal. */
  initialSweepDirection?: 'left' | 'right' | null;
};

export function useGuidedCapture(
  cameraRef: RefObject<CameraView | null>,
  options: UseGuidedCaptureOptions = {}
): UseGuidedCaptureResult {
  const { initialSweepDirection = null } = options;
  const initialSweepDirectionRef = useRef(initialSweepDirection);
  initialSweepDirectionRef.current = initialSweepDirection;
  const [pitchDeg, setPitchDeg] = useState(0);
  const [rollDeg, setRollDeg] = useState(0);
  const [yawDeg, setYawDeg] = useState(0);
  const [gyroMagnitude, setGyroMagnitude] = useState(0);
  const [gravityZ, setGravityZ] = useState(0);
  const [capturedAngles, setCapturedAngles] = useState<CaptureAngle[]>([]);
  /** Active capture session photos (used for overlap gating and progress). */
  const [capturedPhotoUris, setCapturedPhotoUris] = useState<string[]>([]);
  /** Photos retained in-app across sessions and resets. */
  const [libraryPhotoUris, setLibraryPhotoUris] = useState<string[]>([]);
  const [sweepDirection, setSweepDirection] = useState<'left' | 'right' | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Align camera and hold steady.');
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);
  const [isResetDialogVisible, setIsResetDialogVisible] = useState(false);
  const [isStoreHydrated, setIsStoreHydrated] = useState(false);

  const yawRef = useRef(0);
  const lastGyroTsRef = useRef<number | null>(null);
  /** EMA state for sensors (refs only — updated inside listeners). */
  const sensorFilterRef = useRef({
    pitch: 0,
    roll: 0,
    gravityZ: 0,
    accelX: 0,
    accelY: 0,
    accelZ: 0,
    magX: 0,
    magY: 0,
    magZ: 0,
    gyroMag: 0,
    gyroZFiltered: 0,
    hasAccelSample: false,
    hasGyroSample: false,
    hasMagSample: false,
  });
  const headingHorizSmoothRef = useRef<{ x: number; y: number } | null>(null);
  const sessionMagHeadingStartDegRef = useRef<number | null>(null);
  const magnetometerEnabledRef = useRef(false);
  const hasBuzzedForTargetRef = useRef(false);
  const verticalReferencePitchRef = useRef<number | null>(null);
  const captureGuardRef = useRef({ shutterUnlocked: false, isCapturing: false });
  const currentAngleRef = useRef<CaptureAngle>({ pitch: 0, roll: 0, yaw: 0 });
  const autoCaptureGenerationRef = useRef(0);
  const autoCaptureEnabledRef = useRef(false);
  autoCaptureEnabledRef.current = autoCaptureEnabled;

  const hydratedStoreRef = useRef(false);
  const presetSweepAppliedRef = useRef(false);
  /** Survives reset: URL preset or choice from sweep modal. */
  const persistedSweepPresetRef = useRef<'left' | 'right' | null>(initialSweepDirection ?? null);

  const appendUniqueUri = useCallback((list: string[], uri: string) => {
    if (list.includes(uri)) {
      return list;
    }
    return [...list, uri];
  }, []);

  /** Pitch/roll from last accel sample; yaw from `yawRef` (gyro+mag), not `yawDeg` state — state can lag refs and made the overlap bar jump after capture. */
  const readLiveCaptureAngle = useCallback((): CaptureAngle => {
    const f = sensorFilterRef.current;
    if (f.hasAccelSample) {
      return { pitch: f.pitch, roll: f.roll, yaw: yawRef.current };
    }
    return currentAngleRef.current;
  }, []);

  useEffect(() => {
    Accelerometer.setUpdateInterval(SENSOR_LOW_FREQ_INTERVAL_MS);
    Gyroscope.setUpdateInterval(GYROSCOPE_UPDATE_INTERVAL_MS);

    let magSub: { remove: () => void } | null = null;
    let magEffectCancelled = false;
    void Magnetometer.isAvailableAsync().then((ok) => {
      if (magEffectCancelled) {
        return;
      }
      magnetometerEnabledRef.current = ok;
      if (!ok) {
        return;
      }
      Magnetometer.setUpdateInterval(SENSOR_LOW_FREQ_INTERVAL_MS);
      const sub = addMagnetometerListener((data) => {
        const mx = data.x ?? 0;
        const my = data.y ?? 0;
        const mz = data.z ?? 0;
        const α = SENSOR_SMOOTHING_ALPHA;
        const f = sensorFilterRef.current;
        if (!f.hasMagSample) {
          f.magX = mx;
          f.magY = my;
          f.magZ = mz;
          f.hasMagSample = true;
        } else {
          f.magX = α * mx + (1 - α) * f.magX;
          f.magY = α * my + (1 - α) * f.magY;
          f.magZ = α * mz + (1 - α) * f.magZ;
        }
      });
      if (magEffectCancelled) {
        sub.remove();
        return;
      }
      magSub = sub;
    });

    const α = SENSOR_SMOOTHING_ALPHA;

    const accelSub = addAccelerometerListener((data) => {
      const x = data.x ?? 0;
      const y = data.y ?? 0;
      const z = data.z ?? 0;

      const pitch = Math.atan2(-x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);
      const roll = Math.atan2(y, z) * (180 / Math.PI);
      const f = sensorFilterRef.current;
      if (!f.hasAccelSample) {
        f.pitch = pitch;
        f.roll = roll;
        f.gravityZ = z;
        f.accelX = x;
        f.accelY = y;
        f.accelZ = z;
        f.hasAccelSample = true;
      } else {
        f.pitch = α * pitch + (1 - α) * f.pitch;
        f.roll = α * roll + (1 - α) * f.roll;
        f.gravityZ = α * z + (1 - α) * f.gravityZ;
        f.accelX = α * x + (1 - α) * f.accelX;
        f.accelY = α * y + (1 - α) * f.accelY;
        f.accelZ = α * z + (1 - α) * f.accelZ;
      }
      if (verticalReferencePitchRef.current == null) {
        verticalReferencePitchRef.current = f.pitch;
      }

      setPitchDeg(f.pitch);
      setRollDeg(f.roll);
      setGravityZ(f.gravityZ);
    });

    const applyMagnetometerFusion = () => {
      if (!magnetometerEnabledRef.current) {
        return;
      }
      const f = sensorFilterRef.current;
      if (!f.hasAccelSample || !f.hasMagSample) {
        return;
      }
      const { xh, yh } = tiltCompensatedHorizontalMag(
        f.accelX,
        f.accelY,
        f.accelZ,
        f.magX,
        f.magY,
        f.magZ
      );
      const len = Math.hypot(xh, yh);
      if (len < 0.15) {
        return;
      }
      const nx = xh / len;
      const ny = yh / len;
      const β = HEADING_MAG_VECTOR_SMOOTH_ALPHA;
      const prev = headingHorizSmoothRef.current;
      let sx = nx;
      let sy = ny;
      if (prev != null) {
        const vx = β * nx + (1 - β) * prev.x;
        const vy = β * ny + (1 - β) * prev.y;
        const nl = Math.hypot(vx, vy);
        if (nl > 1e-6) {
          sx = vx / nl;
          sy = vy / nl;
        }
      }
      headingHorizSmoothRef.current = { x: sx, y: sy };

      const magHeading = headingDegFromHorizontalMag(sx, sy);
      if (sessionMagHeadingStartDegRef.current == null) {
        sessionMagHeadingStartDegRef.current = magHeading;
        return;
      }
      const magDeltaFromStart = shortestAngleDeltaDeg(
        sessionMagHeadingStartDegRef.current,
        magHeading
      );
      let err = shortestAngleDeltaDeg(yawRef.current, magDeltaFromStart);
      if (Math.abs(err) > HEADING_MAG_ANOMALY_CAP_DEG) {
        err = Math.sign(err) * HEADING_MAG_ANOMALY_CAP_DEG;
      }
      yawRef.current += HEADING_MAG_FUSION_GAIN * err;
    };

    const gyroSub = addGyroscopeListener((data) => {
      const x = data.x ?? 0;
      const y = data.y ?? 0;
      const z = data.z ?? 0;

      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const f = sensorFilterRef.current;
      if (!f.hasGyroSample) {
        f.gyroMag = magnitude;
        const zDead = Math.abs(z) < GYRO_Z_DEADBAND_RAD_S ? 0 : z;
        f.gyroZFiltered = zDead;
        f.hasGyroSample = true;
      } else {
        f.gyroMag = α * magnitude + (1 - α) * f.gyroMag;
        const zDead = Math.abs(z) < GYRO_Z_DEADBAND_RAD_S ? 0 : z;
        f.gyroZFiltered = α * zDead + (1 - α) * f.gyroZFiltered;
      }
      setGyroMagnitude(f.gyroMag);

      const now = Date.now();
      const lastTs = lastGyroTsRef.current;
      if (lastTs != null) {
        const dtSec = (now - lastTs) / 1000;
        yawRef.current += f.gyroZFiltered * dtSec * (180 / Math.PI);
        applyMagnetometerFusion();
        setYawDeg(yawRef.current);
      }
      lastGyroTsRef.current = now;
    });

    return () => {
      magEffectCancelled = true;
      accelSub.remove();
      gyroSub.remove();
      magSub?.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await loadGuidedCaptureStoreState();
        if (cancelled) {
          return;
        }
        setCapturedAngles(state.activeAngles);
        setCapturedPhotoUris(state.activePhotoUris);
        setLibraryPhotoUris(
          state.libraryPhotoUris.length > 0 ? state.libraryPhotoUris : state.activePhotoUris
        );
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
  }, []);

  useEffect(() => {
    if (!hydratedStoreRef.current) {
      return;
    }
    void saveGuidedCaptureStoreState({
      activeAngles: capturedAngles,
      activePhotoUris: capturedPhotoUris,
      libraryPhotoUris,
    });
  }, [capturedAngles, capturedPhotoUris, libraryPhotoUris]);

  /** Apply sweep from URL (only when session has no saved captures yet). */
  useEffect(() => {
    if (!hydratedStoreRef.current) {
      return;
    }
    if (capturedAngles.length > 0) {
      return;
    }
    const preset = initialSweepDirectionRef.current;
    if (preset !== 'left' && preset !== 'right') {
      return;
    }
    if (presetSweepAppliedRef.current) {
      return;
    }
    persistedSweepPresetRef.current = preset;
    setSweepDirection(preset);
    presetSweepAppliedRef.current = true;
  }, [capturedAngles]);

  const chooseSweepDirection = useCallback((direction: 'left' | 'right') => {
    if (capturedAngles.length > 0) {
      return;
    }
    persistedSweepPresetRef.current = direction;
    setSweepDirection(direction);
    presetSweepAppliedRef.current = true;
  }, [capturedAngles.length]);

  const currentAngle = useMemo<CaptureAngle>(
    () => ({ pitch: pitchDeg, roll: rollDeg, yaw: yawDeg }),
    [pitchDeg, rollDeg, yawDeg]
  );

  const capturedCount = capturedAngles.length;
  const progressRatio = Math.min(capturedCount / MIN_PHOTOS, 1);
  const lastCapture = capturedAngles[capturedAngles.length - 1];

  const isUprightForCapture = Math.abs(gravityZ) <= MAX_FLAT_Z_COMPONENT;
  const isSteady = gyroMagnitude <= MAX_GYRO_SPEED_RAD;

  /** Yaw-only step size vs last capture (handles wrap), used for overlap gating along the sweep. */
  const overlapDelta = lastCapture
    ? Math.abs(shortestAngleDeltaDeg(lastCapture.yaw, currentAngle.yaw))
    : 0;

  const overlapValid = !lastCapture
    ? true
    : overlapDelta >= MIN_OVERLAP_STEP_DEG && overlapDelta <= MAX_OVERLAP_STEP_DEG;
  const yawDeltaSinceLastCapture = lastCapture
    ? shortestAngleDeltaDeg(lastCapture.yaw, currentAngle.yaw)
    : 0;
  const movementDirection = yawDeltaSinceLastCapture >= 0 ? 'right' : 'left';
  const isDirectionValid =
    !lastCapture ||
    !sweepDirection ||
    Math.abs(yawDeltaSinceLastCapture) <= DIRECTION_REVERSAL_TOLERANCE_DEG ||
    movementDirection === sweepDirection;
  const overlapGuideOffsetPx = Math.max(-34, Math.min(34, yawDeltaSinceLastCapture * 4));
  const overlapGuideProgressPct = lastCapture
    ? Math.min((overlapDelta / OVERLAP_PROGRESS_REFERENCE_DEG) * 100, 100)
    : 0;
  const overlapTargetReached =
    overlapGuideProgressPct >= OVERLAP_TARGET_PERCENT && overlapGuideProgressPct <= 100;
  const movingWrongWay =
    Boolean(lastCapture) &&
    Boolean(sweepDirection) &&
    Math.abs(yawDeltaSinceLastCapture) > DIRECTION_REVERSAL_TOLERANCE_DEG &&
    movementDirection !== sweepDirection;

  const motionBar = useMemo(() => {
    if (capturedCount === 0 || !lastCapture) {
      return {
        fill01: 0,
        isComplete: false,
        anchorStart: true,
        caption: 'Take your first picture. After that, walk slowly around the vehicle for the rest.',
      };
    }

    if (sweepDirection == null) {
      const firstYaw = capturedAngles[0]?.yaw ?? currentAngle.yaw;
      const delta = shortestAngleDeltaDeg(firstYaw, currentAngle.yaw);
      const mag = Math.abs(delta);
      const fill01 = Math.min(mag / SWEEP_INFER_MIN_YAW_DEG, 1);
      const anchorStart = delta >= 0;
      const caption =
        fill01 < 0.5
          ? 'Take a small step left or right along the vehicle so we know which way you are going.'
          : 'Keep going a little — you are choosing which way to walk around the vehicle.';
      return {
        fill01,
        isComplete: false,
        anchorStart,
        caption,
      };
    }

    if (movingWrongWay) {
      return {
        fill01: 0,
        isComplete: false,
        anchorStart: sweepDirection === 'right',
        caption:
          'You turned the wrong way — walk back the other direction around the vehicle, the same way you started.',
      };
    }

    const barTarget = MOTION_BAR_FILL_TARGET_PERCENT;
    const fill01 = Math.min(overlapGuideProgressPct / barTarget, 1);
    const isComplete = overlapGuideProgressPct >= barTarget;
    const anchorStart = sweepDirection === 'right';

    const caption = isComplete
      ? 'Nice — hold the phone steady for your next picture.'
      : 'Walk slowly along the vehicle. The bar fills as you move into place for the next shot.';

    return {
      fill01,
      isComplete,
      anchorStart,
      caption,
    };
  }, [
    capturedAngles,
    capturedCount,
    currentAngle.yaw,
    lastCapture,
    movingWrongWay,
    overlapGuideProgressPct,
    sweepDirection,
  ]);

  /**
   * Freeze the bar only while the shutter pipeline runs. Freezing on `isSteady` made the bar fall
   * out of sync with the green overlap frame (`overlapGuideOffsetPx`), which stays live — users
   * expect both to move together.
   */
  const motionBarDisplayRef = useRef(motionBar);
  const shouldFreezeMotionBarUi = isCapturing;
  if (!shouldFreezeMotionBarUi) {
    motionBarDisplayRef.current = motionBar;
  }
  const motionBarForUi = shouldFreezeMotionBarUi ? motionBarDisplayRef.current : motionBar;

  const pitchDeltaFromReference =
    verticalReferencePitchRef.current == null
      ? 0
      : Math.abs(currentAngle.pitch - verticalReferencePitchRef.current);
  const isVerticalMovementWithinLimit = pitchDeltaFromReference <= MAX_VERTICAL_PITCH_DELTA_DEG;

  const captureEvaluation = evaluateGuidedCaptureState({
    capturedCount,
    minPhotos: MIN_PHOTOS,
    isCarInFrame: true,
    isUprightForCapture,
    isSteady,
    isVerticalMovementWithinLimit,
    hasPreviousCapture: Boolean(lastCapture),
    overlapValid,
    overlapDelta,
    minOverlapStepDeg: MIN_OVERLAP_STEP_DEG,
    isDirectionValid,
    sweepDirection,
    isCapturing,
  });
  const shutterUnlocked = captureEvaluation.canCapture;
  /** View Images opens the gallery modal; enabled after the first capture. */
  const submitEnabled = libraryPhotoUris.length >= 1 && !isCapturing;

  /** Infer sweep from yaw only when direction was not preset and not yet locked. */
  useEffect(() => {
    if (sweepDirection !== null) {
      return;
    }
    if (capturedAngles.length !== 1) {
      return;
    }
    const first = capturedAngles[0];
    const delta = shortestAngleDeltaDeg(first.yaw, currentAngle.yaw);
    if (Math.abs(delta) >= SWEEP_INFER_MIN_YAW_DEG) {
      setSweepDirection(delta >= 0 ? 'right' : 'left');
    }
  }, [capturedAngles, sweepDirection, currentAngle.yaw]);

  const captureButtonLabel = useMemo(() => {
    if (isCapturing) {
      return 'Capturing';
    }
    if (captureEvaluation.invalidReason === 'SWEEP_DIRECTION_PENDING') {
      return 'Move Left or Right around the vehicle';
    }
    if (captureEvaluation.invalidReason === 'OVERLAP_TOO_SMALL' && sweepDirection) {
      return sweepDirection === 'right' ? 'Move slightly to the Right' : 'Move slightly to the Left';
    }
    if (shutterUnlocked) {
      return 'Capture';
    }
    return captureEvaluation.statusMessage;
  }, [
    isCapturing,
    captureEvaluation.invalidReason,
    captureEvaluation.statusMessage,
    sweepDirection,
    shutterUnlocked,
  ]);

  captureGuardRef.current.shutterUnlocked = shutterUnlocked;
  captureGuardRef.current.isCapturing = isCapturing;
  currentAngleRef.current = currentAngle;

  useEffect(() => {
    setStatusMessage(captureEvaluation.statusMessage);
  }, [captureEvaluation.statusMessage]);

  const runCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || captureGuardRef.current.isCapturing || !captureGuardRef.current.shutterUnlocked) {
      return;
    }

    try {
      setIsCapturing(true);
      const photo = await cam.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });

      const angle = readLiveCaptureAngle();
      setCapturedAngles((prev) => [...prev, angle]);
      verticalReferencePitchRef.current = angle.pitch;
      if (photo?.uri) {
        // Persist the full-resolution original for upload to R2.
        // prepareImageForZeroDce produces a tiny (≤512px) version only for the
        // Zero-DCE model — it must NOT be the version stored or uploaded.
        let storedUri = photo.uri;
        try {
          storedUri = await persistCapturedPhoto(photo.uri);
        } catch {
          storedUri = photo.uri;
        }
        // Pre-compute the Zero-DCE input in the background (unused until enhancement runs).
        void prepareImageForZeroDce(photo.uri);
        setCapturedPhotoUris((prev) => [...prev, storedUri]);
        setLibraryPhotoUris((prev) => appendUniqueUri(prev, storedUri));
      }
    } catch {
      setStatusMessage('Capture failed. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [appendUniqueUri, cameraRef, readLiveCaptureAngle]);

  useEffect(() => {
    if (!lastCapture) {
      hasBuzzedForTargetRef.current = false;
      return;
    }

    if (overlapTargetReached && isUprightForCapture && isSteady && !hasBuzzedForTargetRef.current) {
      hasBuzzedForTargetRef.current = true;
      const generation = autoCaptureGenerationRef.current;
      void (async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await new Promise<void>((r) => setTimeout(r, AUTO_CAPTURE_AFTER_HAPTIC_MS));
        if (generation !== autoCaptureGenerationRef.current) {
          return;
        }
        if (!autoCaptureEnabledRef.current) {
          return;
        }
        await runCapture();
      })();
      return;
    }

    if (!overlapTargetReached) {
      hasBuzzedForTargetRef.current = false;
    }
  }, [lastCapture, overlapTargetReached, isUprightForCapture, isSteady, runCapture]);

  useEffect(() => {
    return () => {
      autoCaptureGenerationRef.current += 1;
    };
  }, []);

  const onSubmitPhotos = () => {
    if (!submitEnabled) {
      return;
    }
    setIsPreviewVisible(true);
  };

  const resetEnabled = capturedCount > 0;

  const onResetCapture = () => {
    if (!resetEnabled) {
      return;
    }
    setIsResetDialogVisible(true);
  };

  const onCancelResetDialog = () => {
    setIsResetDialogVisible(false);
  };

  const onConfirmResetDialog = () => {
    setIsResetDialogVisible(false);
    autoCaptureGenerationRef.current += 1;
    const urisToDelete = [...libraryPhotoUris];
    setCapturedAngles([]);
    setCapturedPhotoUris([]);
    setLibraryPhotoUris([]);
    const preset = persistedSweepPresetRef.current;
    setSweepDirection(preset === 'left' || preset === 'right' ? preset : null);
    presetSweepAppliedRef.current = preset === 'left' || preset === 'right';
    setIsPreviewVisible(false);
    hasBuzzedForTargetRef.current = false;
    verticalReferencePitchRef.current = null;
    setStatusMessage('Capture reset. Previous photos cleared.');
    void deleteGuidedCapturePhotos(urisToDelete);
    void clearPersistedClaimUploadSuccess();
    void clearInsurerCallMeta();
    void clearGuidedCaptureEntryMeta();
    void clearReportAccidentEntryMeta();
  };

  const onClosePreview = () => {
    setIsPreviewVisible(false);
  };

  return {
    capturedCount,
    capturedPhotoUris: libraryPhotoUris,
    progressRatio,
    motionBarFill01: motionBarForUi.fill01,
    motionBarComplete: motionBarForUi.isComplete,
    motionBarAnchorStart: motionBarForUi.anchorStart,
    motionBarCaption: motionBarForUi.caption,
    overlapGuideOffsetPx,
    overlapGuideProgressPct,
    isVerticalMovementWithinLimit,
    isDirectionValid,
    sweepDirection,
    captureState: captureEvaluation.state,
    invalidReason: captureEvaluation.invalidReason,
    isUprightForCapture,
    shutterUnlocked,
    submitEnabled,
    statusMessage,
    isPreviewVisible,
    onCapture: runCapture,
    onSubmitPhotos,
    onResetCapture,
    onClosePreview,
    captureButtonLabel,
    autoCaptureEnabled,
    onToggleAutoCapture: () => setAutoCaptureEnabled((v) => !v),
    resetEnabled,
    isResetDialogVisible,
    onCancelResetDialog,
    onConfirmResetDialog,
    isStoreHydrated,
    chooseSweepDirection,
  };
}
