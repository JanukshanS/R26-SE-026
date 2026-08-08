import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

import { type InsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { type GuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { loadDrunkTestState } from '@/features/drunk-test/storage/drunk-test-store';
import { loadDrivingLicenceState } from '@/features/driving-licence/storage/driving-licence-store';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';
import { loadThirdPartyState } from '@/features/third-party/storage/third-party-store';
import {
  clearUploadProgress,
  loadUploadProgress,
  saveUploadProgress,
} from '@/lib/claim-upload-progress-store';
import { loadPhotoGps } from '@/lib/photo-gps-store';

/** Guided-capture walkaround photo URIs in stop/height order (matches how they were captured). */
async function loadGuidedWalkaroundUris(): Promise<string[]> {
  const { photos } = await loadGuidedCaptureStoreState();
  return [...photos]
    .sort((a, b) => {
      if (a.stopIndex !== b.stopIndex) return a.stopIndex - b.stopIndex;
      return HEIGHT_STEPS.indexOf(a.heightStep) - HEIGHT_STEPS.indexOf(b.heightStep);
    })
    .map((p) => p.uri);
}

/**
 * Base URL for the Guided Camera FastAPI backend (no trailing slash).
 * Set in `frontend/.env`, e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.10:8000`
 * when the phone and Mac are on the same Wi‑Fi. Restart Expo after changing.
 */
export function getCaptureApiBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  return raw.trim().replace(/\/$/, '');
}

/**
 * Supabase access token for the current session, or null when signed out.
 * Read per request rather than once per flow: a guided-capture upload can run
 * longer than the token's one-hour lifetime, and supabase-js hands back the
 * refreshed token here.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Authorization header for the claims backend, which rejects unauthenticated
 * requests with 401. Only the header — never set Content-Type alongside
 * FormData or React Native drops the multipart boundary.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You need to be signed in to upload a claim.');
  }
  return { Authorization: `Bearer ${token}` };
}

/** Last path segment extension only (full-path `split('.').pop()` is wrong for dotted folders). */
function extensionFromUri(uri: string): string | null {
  const path = (uri.split('?')[0]?.split('#')[0] ?? '').replace(/\\/g, '/');
  const seg = path.split('/').pop() ?? path;
  const i = seg.lastIndexOf('.');
  if (i <= 0 || i >= seg.length - 1) {
    return null;
  }
  return seg.slice(i + 1).toLowerCase();
}

function mimeForUri(uri: string): { name: string; type: string } {
  const ext = extensionFromUri(uri) ?? 'jpg';
  if (ext === 'png') {
    return { name: `photo.png`, type: 'image/png' };
  }
  if (ext === 'heic' || ext === 'heif') {
    return { name: `photo.heic`, type: 'image/heic' };
  }
  if (ext === 'mp4' || ext === 'm4v') {
    return { name: `clip.mp4`, type: 'video/mp4' };
  }
  if (ext === 'mov') {
    return { name: `clip.mov`, type: 'video/quicktime' };
  }
  if (ext === 'webm') {
    return { name: `clip.webm`, type: 'video/webm' };
  }
  return { name: `photo.jpg`, type: 'image/jpeg' };
}

/** Drunk-test slot: always video MIME so multipart + server infer `.mp4` even if the URI has no extension. */
function mimeForDrunkTestVideo(uri: string): { name: string; type: string } {
  const ext = extensionFromUri(uri);
  if (ext === 'mov') {
    return { name: 'drunk-test.mov', type: 'video/quicktime' };
  }
  if (ext === 'm4v') {
    return { name: 'drunk-test.m4v', type: 'video/mp4' };
  }
  if (ext === 'webm') {
    return { name: 'drunk-test.webm', type: 'video/webm' };
  }
  return { name: 'drunk-test.mp4', type: 'video/mp4' };
}

type FraudMediaSlot = { uri: string; drunkTestVideo?: boolean };

async function uriFileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

async function takeUpToThreeSlots(
  primary: [string | null, string | null, string | null],
  library: string[]
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of [...primary, ...library]) {
    if (out.length >= 3) break;
    if (!u || seen.has(u)) continue;
    if (await uriFileExists(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/**
 * Up to 6 images after guided capture: your licence (up to 3) + third-party (up to 3 when applicable).
 * Skips missing files; uses library URIs only to fill empty canonical slots.
 */
export async function collectAncillaryClaimPhotoUris(): Promise<string[]> {
  const licence = await loadDrivingLicenceState();
  const third = await loadThirdPartyState();
  const own = await takeUpToThreeSlots(
    [licence.frontUri, licence.backUri, licence.selfieUri],
    licence.libraryUris
  );
  if (third.notApplicable) {
    return own;
  }
  const other = await takeUpToThreeSlots(
    [third.driverLicenceFrontUri, third.driverLicenceBackUri, third.revenueLicenceUri],
    third.libraryUris
  );
  return [...own, ...other].slice(0, 6);
}

/** Driving licence photos (front, back, selfie) + drunk-test video → user-verification subfolder. */
async function collectUserVerificationSlots(): Promise<FraudMediaSlot[]> {
  const licence = await loadDrivingLicenceState();
  const drunk = await loadDrunkTestState();
  const own = await takeUpToThreeSlots(
    [licence.frontUri, licence.backUri, licence.selfieUri],
    licence.libraryUris
  );
  const slots: FraudMediaSlot[] = own.map((uri) => ({ uri }));
  if (drunk.videoUri && (await uriFileExists(drunk.videoUri))) {
    slots.push({ uri: drunk.videoUri, drunkTestVideo: true });
  }
  return slots;
}

/** Third-party photos (driver licence front, back, revenue licence) → third-party subfolder. */
async function collectThirdPartySlots(): Promise<FraudMediaSlot[]> {
  const third = await loadThirdPartyState();
  if (third.notApplicable) return [];
  const other = await takeUpToThreeSlots(
    [third.driverLicenceFrontUri, third.driverLicenceBackUri, third.revenueLicenceUri],
    third.libraryUris
  );
  return other.map((uri) => ({ uri }));
}

export type ClaimantPayload = {
  fullName: string;
  nic: string;
  licenceNumber: string;
};

/** The claim's vehicle (make + model, its insurance policy number, and plate/reg number if set). */
export type VehiclePayload = {
  model: string;
  policyNumber?: string;
  plateNumber?: string;
};

export type ReportPayload = {
  /** ISO-8601 UTC (matches “Captured and submitted” moment). */
  capturedAtIso: string;
  /**
   * Same string shown under location on Upload Accident Details (`formatTimestamp` / device local time, e.g. IST).
   * Sent as `report_captured_at_display_local` and mirrored in R2 as `report-timestamp-local`.
   */
  capturedAtDisplayLocal?: string;
  gpsLat: number | null;
  gpsLng: number | null;
  locationLabel: string;
};

async function postOriginalMedia(
  base: string,
  captureId: string,
  photoIndex: number,
  slot: FraudMediaSlot,
  photoSlot: 'walkaround' | 'user-verification' | 'third-party',
  signal?: AbortSignal
): Promise<void> {
  const { uri, drunkTestVideo } = slot;
  const { name, type } = drunkTestVideo ? mimeForDrunkTestVideo(uri) : mimeForUri(uri);
  const formData = new FormData();
  formData.append('photo_index', String(photoIndex));
  formData.append('asset_kind', 'original');
  formData.append('photo_slot', photoSlot);
  formData.append('photo', { uri, name, type } as unknown as Blob);
  const gps = await loadPhotoGps(uri);
  if (gps) {
    formData.append('gps_lat', String(gps.lat));
    formData.append('gps_lng', String(gps.lng));
    if (gps.accuracy != null) formData.append('gps_accuracy', String(gps.accuracy));
    formData.append('captured_at_client', gps.capturedAt);
  }

  const upRes = await fetch(`${base}/captures/${captureId}/photos`, {
    method: 'POST',
    headers: await authHeaders(),
    body: formData,
    signal,
  });
  if (!upRes.ok) {
    const text = await upRes.text();
    throw new Error(`Upload failed (${upRes.status}): ${text.slice(0, 200)}`);
  }
}

type CombinedUploadItem = {
  slot: FraudMediaSlot;
  photoSlot: 'walkaround' | 'user-verification' | 'third-party';
};

/**
 * Reuses a previously-started capture session for this exact photo bundle if one exists and
 * the server confirms it's still accepting uploads; otherwise starts a fresh one. This is what
 * lets an interrupted upload (e.g. app killed mid-upload) resume instead of restarting from 0.
 */
async function resolveCaptureSession(
  base: string,
  uploadKey: string,
  reportedAtIso: string,
  createPayload: Record<string, unknown>,
  totalItems: number,
  signal: AbortSignal | undefined
): Promise<{ captureId: string; resumeIndex: number; alreadyComplete: boolean }> {
  const existing = await loadUploadProgress(uploadKey);
  if (existing) {
    try {
      const statusRes = await fetch(`${base}/captures/${existing.captureId}/status`, {
        headers: await authHeaders(),
        signal,
      });
      if (statusRes.ok) {
        const statusJson = (await statusRes.json()) as { status?: string };
        if (statusJson.status === 'uploading') {
          return {
            captureId: existing.captureId,
            resumeIndex: Math.min(existing.nextIndex, totalItems),
            alreadyComplete: false,
          };
        }
        // Status moved past "uploading" (e.g. POST .../complete already succeeded in a
        // prior attempt, but the app was killed before the local success flag was written).
        // Nothing left to upload — the caller should treat this as already done.
        await clearUploadProgress();
        return { captureId: existing.captureId, resumeIndex: totalItems, alreadyComplete: true };
      }
    } catch {
      // Network error checking status — fall through and start a fresh capture below.
    }
  }

  const createRes = await fetch(`${base}/captures`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify(createPayload),
    signal,
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Create capture failed (${createRes.status}): ${text.slice(0, 200)}`);
  }
  const capture = (await createRes.json()) as { id: string };
  await saveUploadProgress({ uploadKey, captureId: capture.id, nextIndex: 0, totalItems, reportedAtIso });
  return { captureId: capture.id, resumeIndex: 0, alreadyComplete: false };
}

/**
 * Creates (or resumes) a capture session, uploads guided walkaround photos, then
 * fraud-validation media (licence + third-party images, then drunk-test video when present;
 * same session, continuing `photo_index`), then completes. `POST /complete` runs only after
 * all uploads. Progress is persisted after every photo so an interrupted upload (e.g. the app
 * is killed) resumes from where it stopped on the next attempt instead of starting over.
 */
export async function uploadFullClaimBundleToBackend(options: {
  /** Same key used to gate re-submission — also identifies which photo bundle any saved
   * resume progress belongs to (a different bundle means the old progress no longer applies). */
  uploadKey: string;
  report: ReportPayload;
  claimant: ClaimantPayload;
  /** The vehicle this claim is for — its insurance provider/policy can differ
   * per vehicle, so this comes from the vehicle record, not the claimant. */
  vehicle?: VehiclePayload;
  insurerCallMeta?: InsurerCallMeta | null;
  guidedCaptureEntryMeta?: GuidedCaptureEntryMeta | null;
  onGuidedProgress: (percent: number) => void;
  onFraudProgress: (percent: number) => void;
  /** Fired once walkaround originals are on the server and guided progress is 100% (before fraud-validation uploads). */
  onGuidedWalkaroundUploadsComplete?: () => void;
  /** Fired once licence / third-party / drunk-test media is uploaded and fraud progress is 100% (before `POST .../complete`). */
  onFraudValidationMediaUploadsComplete?: () => void;
  signal?: AbortSignal;
}): Promise<{ captureId: string }> {
  const base = getCaptureApiBaseUrl();
  if (!base) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. Add to apps/mobile/.env, e.g. EXPO_PUBLIC_API_URL=http://YOUR_MAC_LAN_IP:8000'
    );
  }

  const guidedUris = await loadGuidedWalkaroundUris();

  if (guidedUris.length === 0) {
    throw new Error('No guided capture photos found. Complete the walkaround capture first.');
  }

  const userVerificationSlots = await collectUserVerificationSlots();
  const thirdPartySlots = await collectThirdPartySlots();

  const guidedTotal = guidedUris.length;
  const combined: CombinedUploadItem[] = [
    ...guidedUris.map((uri): CombinedUploadItem => ({ slot: { uri }, photoSlot: 'walkaround' })),
    ...userVerificationSlots.map((slot): CombinedUploadItem => ({ slot, photoSlot: 'user-verification' })),
    ...thirdPartySlots.map((slot): CombinedUploadItem => ({ slot, photoSlot: 'third-party' })),
  ];
  const fraudTotal = combined.length - guidedTotal;

  const displayLocal = options.report.capturedAtDisplayLocal?.trim();
  const createPayload: Record<string, unknown> = {
    claimant_name: options.claimant.fullName.trim() || null,
    claimant_nic: options.claimant.nic.trim() || null,
    claimant_licence_number: options.claimant.licenceNumber.trim() || null,
    vehicle_model: options.vehicle?.model.trim() || null,
    policy_number: options.vehicle?.policyNumber?.trim() || null,
    vehicle_reg_no: options.vehicle?.plateNumber?.trim() || null,
    report_captured_at: options.report.capturedAtIso,
    report_captured_at_display_local: displayLocal || null,
    report_gps_lat: options.report.gpsLat,
    report_gps_lng: options.report.gpsLng,
    report_location_label: options.report.locationLabel.trim() || null,
    insurer_call_at: options.insurerCallMeta?.capturedAtIso ?? null,
    insurer_call_captured_at_display_local: options.insurerCallMeta?.capturedAtDisplayLocal ?? null,
    insurer_call_gps_lat: options.insurerCallMeta?.latitude ?? null,
    insurer_call_gps_lng: options.insurerCallMeta?.longitude ?? null,
    insurer_call_location_permission: options.insurerCallMeta?.locationPermission ?? null,
    insurer_call_location_label: options.insurerCallMeta?.locationLabel ?? null,
    guided_capture_started_at: options.guidedCaptureEntryMeta?.capturedAtIso ?? null,
    guided_capture_start_captured_at_display_local: options.guidedCaptureEntryMeta?.capturedAtDisplayLocal ?? null,
    guided_capture_start_gps_lat: options.guidedCaptureEntryMeta?.latitude ?? null,
    guided_capture_start_gps_lng: options.guidedCaptureEntryMeta?.longitude ?? null,
    guided_capture_start_location_permission: options.guidedCaptureEntryMeta?.locationPermission ?? null,
    guided_capture_start_location_label: options.guidedCaptureEntryMeta?.locationLabel ?? null,
  };

  const { captureId, resumeIndex, alreadyComplete } = await resolveCaptureSession(
    base,
    options.uploadKey,
    options.report.capturedAtIso,
    createPayload,
    combined.length,
    options.signal
  );

  if (alreadyComplete) {
    options.onGuidedProgress(100);
    options.onFraudProgress(100);
    options.onGuidedWalkaroundUploadsComplete?.();
    options.onFraudValidationMediaUploadsComplete?.();
    return { captureId };
  }

  // Reflect anything already uploaded in a prior attempt immediately, rather than
  // replaying the whole progress bar from 0.
  if (resumeIndex >= guidedTotal) {
    options.onGuidedProgress(100);
    options.onGuidedWalkaroundUploadsComplete?.();
  } else {
    options.onGuidedProgress(resumeIndex === 0 ? 2 : 5 + Math.round((resumeIndex / guidedTotal) * 95));
  }

  for (let i = resumeIndex; i < guidedTotal; i++) {
    const { slot } = combined[i]!;
    await postOriginalMedia(base, captureId, i, slot, 'walkaround', options.signal);
    await saveUploadProgress({
      uploadKey: options.uploadKey,
      captureId,
      nextIndex: i + 1,
      totalItems: combined.length,
      reportedAtIso: options.report.capturedAtIso,
    });
    const pct = 5 + Math.round(((i + 1) / guidedTotal) * 95);
    options.onGuidedProgress(pct);
  }
  if (resumeIndex < guidedTotal) {
    options.onGuidedProgress(100);
    options.onGuidedWalkaroundUploadsComplete?.();
  }

  if (fraudTotal === 0) {
    options.onFraudProgress(100);
  } else {
    const fraudResumeIndex = Math.max(resumeIndex, guidedTotal);
    const doneBefore = fraudResumeIndex - guidedTotal;
    options.onFraudProgress(doneBefore === 0 ? 0 : Math.round((doneBefore / fraudTotal) * 100));
    for (let i = fraudResumeIndex; i < combined.length; i++) {
      const { slot, photoSlot } = combined[i]!;
      await postOriginalMedia(base, captureId, i, slot, photoSlot, options.signal);
      await saveUploadProgress({
        uploadKey: options.uploadKey,
        captureId,
        nextIndex: i + 1,
        totalItems: combined.length,
        reportedAtIso: options.report.capturedAtIso,
      });
      const done = i + 1 - guidedTotal;
      options.onFraudProgress(Math.round((done / fraudTotal) * 100));
    }
    options.onFraudProgress(100);
  }
  options.onFraudValidationMediaUploadsComplete?.();

  const completeRes = await fetch(`${base}/captures/${captureId}/complete`, {
    method: 'POST',
    headers: await authHeaders(),
    signal: options.signal,
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(`Complete failed (${completeRes.status}): ${text.slice(0, 200)}`);
  }
  await clearUploadProgress();

  return { captureId };
}
