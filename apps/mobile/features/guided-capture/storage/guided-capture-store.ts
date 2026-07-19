import * as FileSystem from 'expo-file-system/legacy';

import type { StopPhoto } from '@/features/guided-capture/types';

type GuidedCaptureStoreState = {
  photos: StopPhoto[];
};

const EMPTY_STATE: GuidedCaptureStoreState = {
  photos: [],
};

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'guided-capture/';
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

export async function loadGuidedCaptureStoreState(): Promise<GuidedCaptureStoreState> {
  try {
    await ensureStorageReady();
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return EMPTY_STATE;
    const content = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(content) as Partial<GuidedCaptureStoreState>;
    return {
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveGuidedCaptureStoreState(state: GuidedCaptureStoreState): Promise<void> {
  await ensureStorageReady();
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
}

export async function persistCapturedPhoto(sourceUri: string): Promise<string> {
  await ensureStorageReady();
  const info = await FileSystem.getInfoAsync(sourceUri);
  if (!info.exists) return sourceUri;
  const ext = getFileExtension(sourceUri);
  const destUri = PHOTOS_DIR + `capture-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destUri });
  return destUri;
}

export async function deleteGuidedCapturePhotos(uris: string[]): Promise<void> {
  for (const uri of [...new Set(uris)]) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}
