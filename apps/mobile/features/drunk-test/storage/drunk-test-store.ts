import * as FileSystem from 'expo-file-system/legacy';

export type DrunkTestStoreState = {
  videoUri: string | null;
};

export function isDrunkTestVideoCaptured(state: DrunkTestStoreState): boolean {
  return state.videoUri != null;
}

const EMPTY_STATE: DrunkTestStoreState = { videoUri: null };

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'drunk-test/';
const STATE_FILE = ROOT_DIR + 'state.json';

async function uriExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

export async function loadDrunkTestState(): Promise<DrunkTestStoreState> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return EMPTY_STATE;
    const content = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(content) as Partial<DrunkTestStoreState>;
    const videoUri = typeof parsed.videoUri === 'string' ? parsed.videoUri : null;
    return {
      videoUri: videoUri && (await uriExists(videoUri)) ? videoUri : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveDrunkTestState(state: DrunkTestStoreState): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
}

export async function deleteDrunkTestVideo(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // best-effort
  }
}
