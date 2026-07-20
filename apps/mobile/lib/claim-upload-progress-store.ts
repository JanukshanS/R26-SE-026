import * as FileSystem from 'expo-file-system/legacy';

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const PROGRESS_FILE = ROOT_DIR + 'last-upload-progress.json';

export type ClaimUploadProgress = {
  /** Which photo bundle this progress belongs to — see computeClaimBundleUploadKey. */
  uploadKey: string;
  /** Backend capture session to resume into (never create a new one if this still applies). */
  captureId: string;
  /** Next combined photo index (guided walkaround, then fraud-validation media) to upload. */
  nextIndex: number;
};

export async function saveUploadProgress(progress: ClaimUploadProgress): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(PROGRESS_FILE, JSON.stringify(progress));
}

/**
 * Returns the saved progress only if it belongs to the exact same photo bundle —
 * if the bundle changed since the interrupted attempt (e.g. a photo was deleted and
 * retaken), the old progress no longer applies and this returns null.
 */
export async function loadUploadProgress(uploadKey: string): Promise<ClaimUploadProgress | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(PROGRESS_FILE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(PROGRESS_FILE)) as Partial<ClaimUploadProgress>;
    if (
      typeof parsed.uploadKey !== 'string' ||
      typeof parsed.captureId !== 'string' ||
      typeof parsed.nextIndex !== 'number'
    ) {
      return null;
    }
    if (parsed.uploadKey !== uploadKey) {
      return null;
    }
    return { uploadKey: parsed.uploadKey, captureId: parsed.captureId, nextIndex: parsed.nextIndex };
  } catch {
    return null;
  }
}

export async function clearUploadProgress(): Promise<void> {
  try {
    await FileSystem.deleteAsync(PROGRESS_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
