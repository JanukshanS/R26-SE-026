import * as FileSystem from 'expo-file-system/legacy';

import { loadDrunkTestState } from '@/features/drunk-test/storage/drunk-test-store';
import { loadDrivingLicenceState } from '@/features/driving-licence/storage/driving-licence-store';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { loadThirdPartyState } from '@/features/third-party/storage/third-party-store';

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const LAST_SUCCESS_KEY_FILE = ROOT_DIR + 'last-success-bundle-key.txt';
const LAST_SUCCESS_LOCATION_FILE = ROOT_DIR + 'last-success-location.json';
const DISMISSED_CLAIM_ID_FILE = ROOT_DIR + 'dismissed-claim-id.txt';

export type PersistedClaimLocation = {
  locationLine: string;
  timestampLine: string;
};

export async function savePersistedClaimLocation(data: PersistedClaimLocation): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(LAST_SUCCESS_LOCATION_FILE, JSON.stringify(data));
}

export async function loadPersistedClaimLocation(): Promise<PersistedClaimLocation | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(LAST_SUCCESS_LOCATION_FILE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(LAST_SUCCESS_LOCATION_FILE)) as Partial<PersistedClaimLocation>;
    if (typeof parsed.locationLine !== 'string' || typeof parsed.timestampLine !== 'string') return null;
    return { locationLine: parsed.locationLine, timestampLine: parsed.timestampLine };
  } catch {
    return null;
  }
}

function djb2Hex(input: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

export async function computeClaimBundleUploadKey(): Promise<string> {
  const guided = await loadGuidedCaptureStoreState();
  const licence = await loadDrivingLicenceState();
  const third = await loadThirdPartyState();
  const drunk = await loadDrunkTestState();
  const raw = [
    [...guided.photos.map((p) => p.uri)].sort().join(','),
    [licence.frontUri, licence.backUri, licence.selfieUri].filter(Boolean).join(','),
    third.notApplicable
      ? 'na'
      : [third.driverLicenceFrontUri, third.driverLicenceBackUri, third.revenueLicenceUri].filter(Boolean).join(','),
    drunk.videoUri ?? '',
  ].join('#');
  return `bundle-${djb2Hex(raw)}`;
}

export async function getPersistedSuccessfulClaimUploadKey(): Promise<string | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(LAST_SUCCESS_KEY_FILE);
    if (!info.exists) return null;
    const t = (await FileSystem.readAsStringAsync(LAST_SUCCESS_KEY_FILE)).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export async function setPersistedSuccessfulClaimUploadKey(key: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(LAST_SUCCESS_KEY_FILE, key);
}

export async function isClaimReportSubmittedLocked(): Promise<boolean> {
  const k = await getPersistedSuccessfulClaimUploadKey();
  return k != null && k.length > 0;
}

export async function clearPersistedClaimUploadSuccess(): Promise<void> {
  try {
    await FileSystem.deleteAsync(LAST_SUCCESS_KEY_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
  try {
    await FileSystem.deleteAsync(LAST_SUCCESS_LOCATION_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}

/**
 * The claims-privacy id of whichever claim the driver last dismissed via "Start New
 * Claim" — deliberately NOT cleared by clearAllClaimData() (that runs alongside
 * saving this, and would otherwise erase it immediately). Home's Insurance button
 * compares this against the server's most-recent claim id: a match means that claim
 * has already been acknowledged, so don't redirect back to its submitted view even
 * though the server hasn't seen a newer one yet — the driver may be mid-way through
 * a new claim's steps locally. Survives app restarts and same-account re-logins,
 * same as the rest of this file, since it's a plain persisted file.
 */
export async function saveDismissedClaimId(id: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(DISMISSED_CLAIM_ID_FILE, id);
}

export async function loadDismissedClaimId(): Promise<string | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(DISMISSED_CLAIM_ID_FILE);
    if (!info.exists) return null;
    const t = (await FileSystem.readAsStringAsync(DISMISSED_CLAIM_ID_FILE)).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
