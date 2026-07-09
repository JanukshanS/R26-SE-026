export type GuidedCaptureState =
  | 'SEARCHING_CAR'
  | 'START_POSITION'
  | 'SWEEPING'
  | 'PAUSED_INVALID'
  | 'COMPLETE';

export type GuidedCaptureInvalidReason =
  | 'CAR_NOT_IN_FRAME'
  | 'PHONE_NOT_UPRIGHT'
  | 'DEVICE_UNSTEADY'
  | 'VERTICAL_DRIFT'
  | 'SWEEP_DIRECTION_PENDING'
  | 'OVERLAP_TOO_SMALL'
  | 'OVERLAP_TOO_LARGE'
  | 'WRONG_DIRECTION'
  | 'CAPTURING_IN_PROGRESS';

export type GuidedCaptureEvaluationInput = {
  capturedCount: number;
  minPhotos: number;
  isCarInFrame: boolean;
  isUprightForCapture: boolean;
  isSteady: boolean;
  isVerticalMovementWithinLimit: boolean;
  hasPreviousCapture: boolean;
  overlapValid: boolean;
  overlapDelta: number;
  minOverlapStepDeg: number;
  isDirectionValid: boolean;
  /** Inferred after first photo from yaw movement; required from second photo onward. */
  sweepDirection: 'left' | 'right' | null;
  isCapturing: boolean;
};

export type GuidedCaptureEvaluationResult = {
  state: GuidedCaptureState;
  canCapture: boolean;
  invalidReason: GuidedCaptureInvalidReason | null;
  statusMessage: string;
};

export function evaluateGuidedCaptureState(
  input: GuidedCaptureEvaluationInput
): GuidedCaptureEvaluationResult {
  if (input.isCapturing) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'CAPTURING_IN_PROGRESS',
      statusMessage: 'Capturing photo...',
    };
  }

  if (!input.isCarInFrame) {
    return {
      state: 'SEARCHING_CAR',
      canCapture: false,
      invalidReason: 'CAR_NOT_IN_FRAME',
      statusMessage: 'Find the vehicle in frame to continue guided capture.',
    };
  }

  if (!input.isUprightForCapture) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'PHONE_NOT_UPRIGHT',
      statusMessage: 'Hold phone upright and portrait',
    };
  }

  if (!input.isSteady) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'DEVICE_UNSTEADY',
      statusMessage: 'Hold still. Motion is too high.',
    };
  }

  if (!input.isVerticalMovementWithinLimit) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'VERTICAL_DRIFT',
      statusMessage: 'Keep the phone level. Avoid moving up or down.',
    };
  }

  if (input.hasPreviousCapture && !input.sweepDirection) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'SWEEP_DIRECTION_PENDING',
      statusMessage: 'Move Left or Right around the vehicle.',
    };
  }

  if (!input.isDirectionValid && input.sweepDirection) {
    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'WRONG_DIRECTION',
      statusMessage: `Do not reverse direction. Continue moving ${input.sweepDirection}.`,
    };
  }

  if (input.hasPreviousCapture && !input.overlapValid) {
    if (input.overlapDelta < input.minOverlapStepDeg) {
      return {
        state: 'PAUSED_INVALID',
        canCapture: false,
        invalidReason: 'OVERLAP_TOO_SMALL',
        statusMessage: 'Move slightly to create a new overlapping view.',
      };
    }

    return {
      state: 'PAUSED_INVALID',
      canCapture: false,
      invalidReason: 'OVERLAP_TOO_LARGE',
      statusMessage: 'Movement too large. Step back to maintain overlap target.',
    };
  }

  if (input.capturedCount >= input.minPhotos) {
    return {
      state: 'COMPLETE',
      canCapture: true,
      invalidReason: null,
      statusMessage: `Minimum ${input.minPhotos} photos complete. You can keep capturing.`,
    };
  }

  if (!input.hasPreviousCapture) {
    return {
      state: 'START_POSITION',
      canCapture: true,
      invalidReason: null,
      statusMessage: 'Start from one side and capture the first photo.',
    };
  }

  return {
    state: 'SWEEPING',
    canCapture: true,
    invalidReason: null,
    statusMessage: 'Angle valid for accident capture. You can take a photo now.',
  };
}
