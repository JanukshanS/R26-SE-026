import * as FileSystem from 'expo-file-system/legacy';

export type PhotoGpsEntry = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

const DIR = `${FileSystem.documentDirectory}photo-gps`;

/** Derive a safe filename from the photo URI (last path segment, strip query/fragment). */
function keyFromUri(uri: string): string {
  const clean = uri.split('?')[0]?.split('#')[0] ?? uri;
  const seg = clean.split('/').pop() ?? 'photo';
  return seg.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function savePhotoGps(uri: string, entry: PhotoGpsEntry): Promise<void> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const path = `${DIR}/${keyFromUri(uri)}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(entry));
}

export async function loadPhotoGps(uri: string): Promise<PhotoGpsEntry | null> {
  const path = `${DIR}/${keyFromUri(uri)}.json`;
  try {
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as PhotoGpsEntry;
  } catch {
    return null;
  }
}

export async function clearAllPhotoGps(): Promise<void> {
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
}

/** Deletes GPS entries for specific photo URIs only — use instead of clearAllPhotoGps when
 * other features' photos share this same store and must not be affected. */
export async function deletePhotoGpsEntries(uris: string[]): Promise<void> {
  for (const uri of uris) {
    const path = `${DIR}/${keyFromUri(uri)}.json`;
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}
