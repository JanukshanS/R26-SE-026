import { describe, expect, it } from 'vitest';

import { evaluateGuidedCaptureState } from './guided-capture-machine';

const baseInput = {
  capturedCount: 0,
  minPhotos: 5,
  isCarInFrame: true,
  isUprightForCapture: true,
  isSteady: true,
  isVerticalMovementWithinLimit: true,
  hasPreviousCapture: false,
  overlapValid: true,
  overlapDelta: 0,
  minOverlapStepDeg: 2.5,
  isDirectionValid: true,
  sweepDirection: 'right' as 'left' | 'right' | null,
  isCapturing: false,
};

describe('guided capture machine', () => {
  it('moves to START_POSITION when waiting for first capture', () => {
    const result = evaluateGuidedCaptureState(baseInput);
    expect(result.state).toBe('START_POSITION');
    expect(result.canCapture).toBe(true);
    expect(result.invalidReason).toBeNull();
  });

  it('allows first photo without sweep direction', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      sweepDirection: null,
    });
    expect(result.state).toBe('START_POSITION');
    expect(result.canCapture).toBe(true);
    expect(result.invalidReason).toBeNull();
  });

  it('blocks until sweep is inferred after first photo', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 1,
      hasPreviousCapture: true,
      sweepDirection: null,
      overlapValid: false,
      overlapDelta: 0.5,
    });
    expect(result.state).toBe('PAUSED_INVALID');
    expect(result.canCapture).toBe(false);
    expect(result.invalidReason).toBe('SWEEP_DIRECTION_PENDING');
  });

  it('pauses with WRONG_DIRECTION when user reverses', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 2,
      hasPreviousCapture: true,
      isDirectionValid: false,
      sweepDirection: 'left',
    });
    expect(result.state).toBe('PAUSED_INVALID');
    expect(result.invalidReason).toBe('WRONG_DIRECTION');
    expect(result.canCapture).toBe(false);
  });

  it('pauses with VERTICAL_DRIFT when moving up/down too much', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 2,
      hasPreviousCapture: true,
      isVerticalMovementWithinLimit: false,
    });
    expect(result.state).toBe('PAUSED_INVALID');
    expect(result.invalidReason).toBe('VERTICAL_DRIFT');
  });

  it('pauses with OVERLAP_TOO_SMALL when step is tiny', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 2,
      hasPreviousCapture: true,
      overlapValid: false,
      overlapDelta: 1.2,
      minOverlapStepDeg: 2.5,
    });
    expect(result.invalidReason).toBe('OVERLAP_TOO_SMALL');
  });

  it('transitions to COMPLETE when minimum photos reached', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 5,
      minPhotos: 5,
      hasPreviousCapture: true,
    });
    expect(result.state).toBe('COMPLETE');
    expect(result.canCapture).toBe(true);
    expect(result.invalidReason).toBeNull();
  });

  it('locks capture when not upright even after minimum photos reached', () => {
    const result = evaluateGuidedCaptureState({
      ...baseInput,
      capturedCount: 7,
      minPhotos: 5,
      hasPreviousCapture: true,
      isUprightForCapture: false,
    });
    expect(result.state).toBe('PAUSED_INVALID');
    expect(result.canCapture).toBe(false);
    expect(result.invalidReason).toBe('PHONE_NOT_UPRIGHT');
  });
});
