import * as FileSystem from 'expo-file-system/legacy';

import { loadDrunkTestState } from '@/features/drunk-test/storage/drunk-test-store';
import { loadDrivingLicenceState } from '@/features/driving-licence/storage/driving-licence-store';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { loadThirdPartyState } from '@/features/third-party/storage/third-party-store';

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const LAST_SUCCESS_KEY_FILE = ROOT_DIR + 'last-success-bundle-key.txt';

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
    [...guided.libraryPhotoUris].sort().join(','),
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
}
