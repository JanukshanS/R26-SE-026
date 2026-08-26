import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Web fallback: expo-file-system throws on web. Photo-GPS is part of the
 * claim capture flow (native-only in practice — cameras + real GPS + BLE
 * telemetry), so on web every function no-ops silently. This never runs on
 * the emergency/dispatch flow.
 */

export type PhotoGpsEntry = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

const DIR = `${FileSystem.documentDirectory}photo-gps`;
const IS_WEB = Platform.OS === 'web';

/** Derive a safe filename from the photo URI (last path segment, strip query/fragment). */
function keyFromUri(uri: string): string {
  const clean = uri.split('?')[0]?.split('#')[0] ?? uri;
  const seg = clean.split('/').pop() ?? 'photo';
  return seg.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function savePhotoGps(uri: string, entry: PhotoGpsEntry): Promise<void> {
  if (IS_WEB) return;
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const path = `${DIR}/${keyFromUri(uri)}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(entry));
}

export async function loadPhotoGps(uri: string): Promise<PhotoGpsEntry | null> {
  if (IS_WEB) return null;
  const path = `${DIR}/${keyFromUri(uri)}.json`;
  try {
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as PhotoGpsEntry;
  } catch {
    return null;
  }
}

export async function clearAllPhotoGps(): Promise<void> {
  if (IS_WEB) return;
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
}

/** Deletes GPS entries for specific photo URIs only — use instead of clearAllPhotoGps when
 * other features' photos share this same store and must not be affected. */
export async function deletePhotoGpsEntries(uris: string[]): Promise<void> {
  if (IS_WEB) return;
  for (const uri of uris) {
    const path = `${DIR}/${keyFromUri(uri)}.json`;
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}
