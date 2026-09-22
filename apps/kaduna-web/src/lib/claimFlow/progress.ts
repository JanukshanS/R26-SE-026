import type { ClaimStage, LocationSnapshot, VerifiedClaimant } from "./types";

/**
 * Everything needed to resume this claim after a reload, in the SAME browser
 * (the anonymous Supabase session it's tied to lives in this browser's own
 * localStorage too — a different device/browser starts a fresh session and,
 * deliberately, a fresh claim rather than silently failing).
 *
 * Only small JSON goes here — photo/video bytes are never buffered client-side
 * across a reload; they're uploaded to Supabase/R2 as soon as each is
 * captured (see uploadApi.ts), which is what actually makes resume safe.
 */
export type ClaimProgress = {
  token: string;
  stage: ClaimStage;
  /** The NIC as the claimant typed it — kept separately since VerifiedClaimant
   * (the verify-claimant response) doesn't echo it back. */
  nic: string;
  claimant: VerifiedClaimant | null;
  reportedAtIso: string;
  captureId: string | null;
  /** Running index across every uploaded original (walkaround, then licence,
   * then drunk-test video, then third-party) — matches capture_photos.photo_index.
   * Fixed offsets per step (see ClaimFlow.tsx's *_START constants) mean each
   * step's own resume count can be derived from this one number alone. */
  nextPhotoIndex: number;
  thirdPartyApplicable: boolean | null;
  insurerCallLocation: LocationSnapshot | null;
  guidedCaptureEntryLocation: LocationSnapshot | null;
  drunkTestEntryLocation: LocationSnapshot | null;
};

function storageKey(token: string): string {
  return `kaduna.claimLink.${token}`;
}

export function loadClaimProgress(token: string): ClaimProgress | null {
  try {
    const raw = window.localStorage.getItem(storageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClaimProgress;
    return parsed.token === token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveClaimProgress(progress: ClaimProgress): void {
  try {
    window.localStorage.setItem(storageKey(progress.token), JSON.stringify(progress));
  } catch {
    // Private mode / storage full — the flow still works, just without resume.
  }
}

export function clearClaimProgress(token: string): void {
  try {
    window.localStorage.removeItem(storageKey(token));
  } catch {
    // best-effort
  }
}

export function newClaimProgress(token: string): ClaimProgress {
  return {
    token,
    stage: "verify",
    nic: "",
    claimant: null,
    reportedAtIso: new Date().toISOString(),
    captureId: null,
    nextPhotoIndex: 0,
    thirdPartyApplicable: null,
    insurerCallLocation: null,
    guidedCaptureEntryLocation: null,
    drunkTestEntryLocation: null,
  };
}
