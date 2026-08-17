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

/**
 * Claim/capture creation, photo upload, and completion — backed directly by Supabase
 * Postgres (RLS-protected) for everything except the two steps that need R2
 * credentials (minting a presigned upload URL, and the final locations.json write),
 * which go through two small Supabase Edge Functions (`sign-photo-upload`,
 * `complete-capture` — see supabase/functions/). Previously all of this proxied
 * through a separate claims-privacy FastAPI service; that service is now retired.
 */

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
 * Supabase access token for the current session, or null when signed out.
 * Read per request rather than once per flow: a guided-capture upload can run
 * longer than the token's one-hour lifetime, and supabase-js hands back the
 * refreshed token here.
 *
 * Kept exported even though claims-privacy is gone — lib/maintenanceApi.ts and
 * lib/dispatchApi.ts (unrelated backends) still import this and authHeaders() below.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Authorization header for the backend services, all of which reject
 * unauthenticated requests with 401. Shared by the dispatch and maintenance
 * clients, so the error stays generic — screens surface this message verbatim.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You need to be signed in. Sign in and try again.');
  }
  return { Authorization: `Bearer ${token}` };
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You need to be signed in. Sign in and try again.');
  return id;
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

type SignPhotoUploadResponse = {
  uploadUrl: string;
  key: string;
  contentType: string;
  metadataHeaders: Record<string, string>;
};

/**
 * Uploads one photo/video: asks the sign-photo-upload Edge Function for a presigned R2
 * PUT URL (the only step that needs R2 credentials), PUTs the file bytes straight to R2
 * via expo-file-system (binary upload — avoids loading the whole file into JS memory,
 * important for the drunk-test video), then records the row directly in Supabase.
 * upsert (not insert) on the same unique constraint the DB enforces
 * (capture_id, photo_index, asset_kind) so a retry after a crash between the R2 PUT
 * succeeding and the local progress checkpoint saving doesn't hard-fail on a duplicate —
 * same resilience the old resumable-upload flow relied on.
 */
async function postOriginalMedia(
  captureId: string,
  photoIndex: number,
  slot: FraudMediaSlot,
  photoSlot: 'walkaround' | 'user-verification' | 'third-party'
): Promise<void> {
  const { uri, drunkTestVideo } = slot;
  const { type } = drunkTestVideo ? mimeForDrunkTestVideo(uri) : mimeForUri(uri);
  const gps = await loadPhotoGps(uri);

  const { data, error } = await supabase.functions.invoke('sign-photo-upload', {
    body: {
      captureId,
      photoIndex,
      assetKind: 'original',
      photoSlot,
      contentType: type,
      gpsLat: gps?.lat ?? null,
      gpsLng: gps?.lng ?? null,
      gpsAccuracy: gps?.accuracy ?? null,
      capturedAtClient: gps?.capturedAt ?? null,
    },
  });
  if (error || !data) {
    throw new Error(`Failed to get upload URL: ${error?.message ?? 'unknown error'}`);
  }
  const { uploadUrl, key, contentType, metadataHeaders } = data as SignPhotoUploadResponse;

  const headers: Record<string, string> = { 'Content-Type': contentType };
  for (const [metaKey, metaValue] of Object.entries(metadataHeaders)) {
    headers[`x-amz-meta-${metaKey}`] = metaValue;
  }

  const uploadResult = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Upload failed (${uploadResult.status}): ${uploadResult.body?.slice(0, 200) ?? ''}`);
  }

  const info = await FileSystem.getInfoAsync(uri);
  const byteSize = info.exists && 'size' in info ? info.size : 0;

  const { error: insertError } = await supabase.from('capture_photos').upsert(
    {
      capture_id: captureId,
      photo_index: photoIndex,
      asset_kind: 'original',
      r2_key: key,
      content_type: contentType,
      byte_size: byteSize,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      gps_accuracy: gps?.accuracy ?? null,
      captured_at_client: gps?.capturedAt ?? null,
    },
    { onConflict: 'capture_id,photo_index,asset_kind' }
  );
  if (insertError) {
    throw new Error(`Failed to save photo metadata: ${insertError.message}`);
  }
}

type CombinedUploadItem = {
  slot: FraudMediaSlot;
  photoSlot: 'walkaround' | 'user-verification' | 'third-party';
};

/**
 * Reuses a previously-started capture session for this exact photo bundle if one exists and
 * is still accepting uploads; otherwise starts a fresh one. This is what lets an interrupted
 * upload (e.g. app killed mid-upload) resume instead of restarting from 0.
 */
async function resolveCaptureSession(
  uploadKey: string,
  reportedAtIso: string,
  createPayload: Record<string, unknown>,
  totalItems: number
): Promise<{ captureId: string; resumeIndex: number; alreadyComplete: boolean }> {
  const existing = await loadUploadProgress(uploadKey);
  if (existing) {
    const { data: existingCapture, error: statusError } = await supabase
      .from('captures')
      .select('status')
      .eq('id', existing.captureId)
      .maybeSingle();
    if (!statusError && existingCapture) {
      if (existingCapture.status === 'uploading') {
        return {
          captureId: existing.captureId,
          resumeIndex: Math.min(existing.nextIndex, totalItems),
          alreadyComplete: false,
        };
      }
      // Status moved past "uploading" (e.g. complete-capture already succeeded in a
      // prior attempt, but the app was killed before the local success flag was written).
      // Nothing left to upload — the caller should treat this as already done.
      await clearUploadProgress();
      return { captureId: existing.captureId, resumeIndex: totalItems, alreadyComplete: true };
    }
    // Network/RLS error checking status — fall through and start a fresh capture below.
  }

  const userId = await currentUserId();
  const { data: capture, error } = await supabase
    .from('captures')
    .insert({ ...createPayload, user_id: userId, status: 'uploading' })
    .select('id')
    .single();
  if (error || !capture) {
    throw new Error(`Create capture failed: ${error?.message ?? 'unknown error'}`);
  }
  await saveUploadProgress({ uploadKey, captureId: capture.id, nextIndex: 0, totalItems, reportedAtIso });
  return { captureId: capture.id, resumeIndex: 0, alreadyComplete: false };
}

/**
 * Creates (or resumes) a capture session, uploads guided walkaround photos, then
 * fraud-validation media (licence + third-party images, then drunk-test video when present;
 * same session, continuing `photo_index`), then completes via the complete-capture Edge
 * Function. Progress is persisted after every photo so an interrupted upload (e.g. the app
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
  /** Fired once licence / third-party / drunk-test media is uploaded and fraud progress is 100% (before completion). */
  onFraudValidationMediaUploadsComplete?: () => void;
  signal?: AbortSignal;
}): Promise<{ captureId: string }> {
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
    options.uploadKey,
    options.report.capturedAtIso,
    createPayload,
    combined.length
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
    await postOriginalMedia(captureId, i, slot, 'walkaround');
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
      await postOriginalMedia(captureId, i, slot, photoSlot);
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

  const { data: completeData, error: completeError } = await supabase.functions.invoke('complete-capture', {
    body: { captureId },
  });
  if (completeError || !completeData) {
    throw new Error(`Complete failed: ${completeError?.message ?? 'unknown error'}`);
  }
  await clearUploadProgress();

  return { captureId };
}
