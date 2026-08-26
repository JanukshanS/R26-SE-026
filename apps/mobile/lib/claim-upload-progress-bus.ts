/**
 * Module-level (not React state) source of truth for the currently-running claim
 * upload's live progress. A plain useState in the upload screen's hook would reset
 * every time that screen unmounts and remounts — which is exactly what happens when
 * the app is backgrounded/reopened while react-native-background-actions keeps the
 * actual upload running independent of any mounted screen. Reading this via
 * useSyncExternalStore instead means a freshly (re)mounted screen sees whatever the
 * background task has already achieved, rather than resetting to a spinner.
 */

export type ClaimUploadPhase =
  | 'idle'
  | 'uploading'
  /** The OS aborted the in-flight request because the app was backgrounded — not a
   * real failure. Auto-retries on its own once the app returns to the foreground. */
  | 'paused'
  /** A genuine failure (server error, etc.) — the partial-upload state has already
   * been cleared by the time this is set, so a retry starts a fresh capture. */
  | 'failed'
  | 'succeeded';

export type ClaimUploadProgressState = {
  uploadKey: string | null;
  phase: ClaimUploadPhase;
  /** null while the real resumed starting point isn't known yet — the UI shows a
   * spinner in that gap instead of a misleading 0%. */
  photosUploadPercent: number | null;
  photosUploadComplete: boolean;
  fraudValidationPercent: number | null;
  fraudValidationComplete: boolean;
  /** Human-readable explanation shown inline — set for both 'paused' and 'failed',
   * with different tones (see use-claim-upload.ts). */
  uploadError: string | null;
};

const IDLE_STATE: ClaimUploadProgressState = {
  uploadKey: null,
  phase: 'idle',
  photosUploadPercent: null,
  photosUploadComplete: false,
  fraudValidationPercent: null,
  fraudValidationComplete: false,
  uploadError: null,
};

/** Stable-reference fallback for a hook to substitute when the bus's current
 * uploadKey belongs to a different (older) claim than the one it cares about —
 * e.g. a stale 'failed' state from a previous claim lingering after Start New
 * Claim. Must stay a single shared reference, not a fresh object per call:
 * useSyncExternalStore requires getSnapshot's result to be referentially
 * stable when nothing has changed, so this substitution happens in the
 * consuming hook (comparing keys), never inside getSnapshot itself. */
export const IDLE_CLAIM_UPLOAD_PROGRESS: ClaimUploadProgressState = IDLE_STATE;

let state: ClaimUploadProgressState = IDLE_STATE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(patch: Partial<ClaimUploadProgressState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeClaimUploadProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getClaimUploadProgressSnapshot(): ClaimUploadProgressState {
  return state;
}

/** Called once, right before a background task starts for this uploadKey. */
export function resetClaimUploadProgress(uploadKey: string) {
  setState({
    uploadKey,
    phase: 'uploading',
    photosUploadPercent: null,
    photosUploadComplete: false,
    fraudValidationPercent: null,
    fraudValidationComplete: false,
    uploadError: null,
  });
}

export function setGuidedProgress(percent: number) {
  setState({ photosUploadPercent: percent });
}

export function setGuidedComplete() {
  setState({ photosUploadPercent: 100, photosUploadComplete: true });
}

export function setFraudProgress(percent: number) {
  setState({ fraudValidationPercent: percent });
}

export function setFraudComplete() {
  setState({ fraudValidationPercent: 100, fraudValidationComplete: true });
}

export function setClaimUploadPaused(message: string) {
  setState({ phase: 'paused', uploadError: message });
}

export function setClaimUploadFailed(message: string) {
  setState({
    phase: 'failed',
    uploadError: message,
    photosUploadPercent: state.photosUploadComplete ? 100 : 0,
    fraudValidationPercent: state.fraudValidationComplete ? 100 : 0,
  });
}

export function setClaimUploadSucceeded() {
  setState({
    phase: 'succeeded',
    uploadError: null,
    photosUploadPercent: 100,
    photosUploadComplete: true,
    fraudValidationPercent: 100,
    fraudValidationComplete: true,
  });
}

/** Used when a screen mount discovers the claim was already fully uploaded in a
 * prior attempt (persisted success key) — no background task involved at all. */
export function markClaimUploadAlreadySucceeded(uploadKey: string) {
  setState({ ...IDLE_STATE, uploadKey, phase: 'succeeded', photosUploadPercent: 100, photosUploadComplete: true, fraudValidationPercent: 100, fraudValidationComplete: true });
}

/** Back to a clean slate — a different claim's upload is starting, or the current
 * claim was reset entirely. */
export function clearClaimUploadProgress() {
  state = IDLE_STATE;
  emit();
}
