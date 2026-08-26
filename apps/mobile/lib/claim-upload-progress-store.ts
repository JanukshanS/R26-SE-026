import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Web fallback: expo-file-system throws on web. Claim-upload progress is
 * part of the native-only claim flow (needs cameras + native BG upload) —
 * on web every function is a no-op so it never blocks the emergency /
 * dispatch demo path.
 */
const IS_WEB = Platform.OS === 'web';

const ROOT_DIR      = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const PROGRESS_FILE = ROOT_DIR + 'last-upload-progress.json';

export type ClaimUploadProgress = {
  uploadKey: string;
  captureId: string;
  nextIndex: number;
  totalItems: number;
  reportedAtIso: string;
};

export async function saveUploadProgress(progress: ClaimUploadProgress): Promise<void> {
  if (IS_WEB) return;
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(PROGRESS_FILE, JSON.stringify(progress));
}

/**
 * Returns the saved progress only if it belongs to the exact same photo bundle —
 * if the bundle changed since the interrupted attempt (e.g. a photo was deleted and
 * retaken), the old progress no longer applies and this returns null.
 */
export async function loadUploadProgress(uploadKey: string): Promise<ClaimUploadProgress | null> {
  if (IS_WEB) return null;
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(PROGRESS_FILE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(PROGRESS_FILE)) as Partial<ClaimUploadProgress>;
    if (
      typeof parsed.uploadKey !== 'string' ||
      typeof parsed.captureId !== 'string' ||
      typeof parsed.nextIndex !== 'number' ||
      typeof parsed.totalItems !== 'number' ||
      typeof parsed.reportedAtIso !== 'string'
    ) {
      return null;
    }
    if (parsed.uploadKey !== uploadKey) {
      return null;
    }
    return {
      uploadKey:     parsed.uploadKey,
      captureId:     parsed.captureId,
      nextIndex:     parsed.nextIndex,
      totalItems:    parsed.totalItems,
      reportedAtIso: parsed.reportedAtIso,
    };
  } catch {
    return null;
  }
}

export async function clearUploadProgress(): Promise<void> {
  if (IS_WEB) return;
  try {
    await FileSystem.deleteAsync(PROGRESS_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
