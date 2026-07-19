import * as FileSystem from 'expo-file-system/legacy';

export type LicenceCaptureState = {
  side: 'front' | 'back' | 'selfie';
  frontUri: string | null;
  backUri: string | null;
  selfieUri: string | null;
  libraryUris: string[];
};

export function isDrivingLicenceCaptureComplete(state: LicenceCaptureState): boolean {
  return state.frontUri != null && state.backUri != null && state.selfieUri != null;
}

const EMPTY_STATE: LicenceCaptureState = {
  side: 'front',
  frontUri: null,
  backUri: null,
  selfieUri: null,
  libraryUris: [],
};

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'driving-licence/';
const PHOTOS_DIR = ROOT_DIR + 'photos/';
const STATE_FILE = ROOT_DIR + 'state.json';

async function ensureStorageReady() {
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
}

function getFileExtension(uri: string): string {
  const path = uri.split('?')[0] ?? uri;
  const index = path.lastIndexOf('.');
  if (index < 0) return 'jpg';
  return path.slice(index + 1);
}

export async function loadDrivingLicenceState(): Promise<LicenceCaptureState> {
  try {
    await ensureStorageReady();
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return EMPTY_STATE;
    const content = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(content) as Partial<LicenceCaptureState>;
    return {
      side: parsed.side === 'front' || parsed.side === 'back' || parsed.side === 'selfie' ? parsed.side : 'front',
      frontUri: parsed.frontUri ?? null,
      backUri: parsed.backUri ?? null,
      selfieUri: parsed.selfieUri ?? null,
      libraryUris: Array.isArray(parsed.libraryUris) ? parsed.libraryUris : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveDrivingLicenceState(state: LicenceCaptureState): Promise<void> {
  await ensureStorageReady();
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
}

export async function persistDrivingLicencePhoto(sourceUri: string): Promise<string> {
  await ensureStorageReady();
  const info = await FileSystem.getInfoAsync(sourceUri);
  if (!info.exists) return sourceUri;
  const ext = getFileExtension(sourceUri);
  const destUri = PHOTOS_DIR + `licence-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destUri });
  return destUri;
}

export async function deleteDrivingLicencePhotos(uris: string[]): Promise<void> {
  for (const uri of [...new Set(uris)]) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}
