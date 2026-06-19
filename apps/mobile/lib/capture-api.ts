import * as FileSystem from 'expo-file-system/legacy';

import { loadDrunkTestState } from '@/features/drunk-test/storage/drunk-test-store';
import { loadDrivingLicenceState } from '@/features/driving-licence/storage/driving-licence-store';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { loadThirdPartyState } from '@/features/third-party/storage/third-party-store';

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

/** Licence + third-party images (max 6), then drunk-test video when present and on disk. */
async function collectFraudValidationMediaSlots(): Promise<FraudMediaSlot[]> {
  const images = await collectAncillaryClaimPhotoUris();
  const drunk = await loadDrunkTestState();
  const slots: FraudMediaSlot[] = images.map((uri) => ({ uri }));
  if (drunk.videoUri && (await uriFileExists(drunk.videoUri))) {
    slots.push({ uri: drunk.videoUri, drunkTestVideo: true });
  }
  return slots;
}

export type ClaimantPayload = {
  fullName: string;
  nic: string;
  licenceNumber: string;
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
  signal?: AbortSignal
): Promise<void> {
  const { uri, drunkTestVideo } = slot;
  const { name, type } = drunkTestVideo ? mimeForDrunkTestVideo(uri) : mimeForUri(uri);
  const formData = new FormData();
  formData.append('photo_index', String(photoIndex));
  formData.append('asset_kind', 'original');
  formData.append('photo', { uri, name, type } as unknown as Blob);

  const upRes = await fetch(`${base}/captures/${captureId}/photos`, {
    method: 'POST',
    body: formData,
    signal,
  });
  if (!upRes.ok) {
    const text = await upRes.text();
    throw new Error(`Upload failed (${upRes.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Creates a capture session, uploads guided walkaround photos, then fraud-validation media
 * (licence + third-party images, then drunk-test video when present; same session, continuing `photo_index`),
 * then completes. `POST /complete` runs only after all uploads.
 */
export async function uploadFullClaimBundleToBackend(options: {
  report: ReportPayload;
  claimant: ClaimantPayload;
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

  const guidedStore = await loadGuidedCaptureStoreState();
  const guidedUris =
    guidedStore.libraryPhotoUris.length > 0
      ? guidedStore.libraryPhotoUris
      : guidedStore.activePhotoUris.length > 0
        ? guidedStore.activePhotoUris
        : [];

  if (guidedUris.length === 0) {
    throw new Error('No guided capture photos found. Complete the walkaround capture first.');
  }

  const fraudMediaSlots = await collectFraudValidationMediaSlots();

  options.onGuidedProgress(2);

  const displayLocal = options.report.capturedAtDisplayLocal?.trim();
  const createPayload: Record<string, unknown> = {
    claimant_name: options.claimant.fullName.trim() || null,
    claimant_nic: options.claimant.nic.trim() || null,
    claimant_licence_number: options.claimant.licenceNumber.trim() || null,
    report_captured_at: options.report.capturedAtIso,
    report_captured_at_display_local: displayLocal || null,
    report_gps_lat: options.report.gpsLat,
    report_gps_lng: options.report.gpsLng,
    report_location_label: options.report.locationLabel.trim() || null,
  };

  const createRes = await fetch(`${base}/captures`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
    signal: options.signal,
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Create capture failed (${createRes.status}): ${text.slice(0, 200)}`);
  }
  const capture = (await createRes.json()) as { id: string };
  const captureId = capture.id;

  const guidedTotal = guidedUris.length;
  for (let i = 0; i < guidedTotal; i++) {
    const uri = guidedUris[i]!;
    await postOriginalMedia(base, captureId, i, { uri }, options.signal);
    const pct = 5 + Math.round(((i + 1) / guidedTotal) * 95);
    options.onGuidedProgress(pct);
  }
  options.onGuidedProgress(100);
  options.onGuidedWalkaroundUploadsComplete?.();

  options.onFraudProgress(0);
  const startIndex = guidedTotal;
  const fraudTotal = fraudMediaSlots.length;
  if (fraudTotal === 0) {
    options.onFraudProgress(100);
  } else {
    for (let j = 0; j < fraudTotal; j++) {
      const slot = fraudMediaSlots[j]!;
      await postOriginalMedia(base, captureId, startIndex + j, slot, options.signal);
      options.onFraudProgress(Math.round(((j + 1) / fraudTotal) * 100));
    }
    options.onFraudProgress(100);
  }
  options.onFraudValidationMediaUploadsComplete?.();

  const completeRes = await fetch(`${base}/captures/${captureId}/complete`, {
    method: 'POST',
    signal: options.signal,
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(`Complete failed (${completeRes.status}): ${text.slice(0, 200)}`);
  }

  return { captureId };
}
