import * as FileSystem from 'expo-file-system/legacy';

export type GuidedCaptureEntryMeta = {
  capturedAtIso: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationPermission: 'granted' | 'denied' | 'unavailable';
  locationLabel: string | null;
  capturedAtDisplayLocal: string | null;
};

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'guided-capture/';
const ENTRY_FILE = ROOT_DIR + 'entry-meta.json';

export async function loadGuidedCaptureEntryMeta(): Promise<GuidedCaptureEntryMeta | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(ENTRY_FILE);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(ENTRY_FILE);
    const parsed = JSON.parse(content) as Partial<GuidedCaptureEntryMeta>;
    if (typeof parsed.capturedAtIso !== 'string') return null;
    return {
      capturedAtIso: parsed.capturedAtIso,
      latitude: typeof parsed.latitude === 'number' ? parsed.latitude : null,
      longitude: typeof parsed.longitude === 'number' ? parsed.longitude : null,
      accuracyMeters: typeof parsed.accuracyMeters === 'number' ? parsed.accuracyMeters : null,
      locationPermission:
        parsed.locationPermission === 'granted' || parsed.locationPermission === 'denied'
          ? parsed.locationPermission
          : 'unavailable',
      locationLabel: typeof parsed.locationLabel === 'string' ? parsed.locationLabel : null,
      capturedAtDisplayLocal: typeof parsed.capturedAtDisplayLocal === 'string' ? parsed.capturedAtDisplayLocal : null,
    };
  } catch {
    return null;
  }
}

export async function saveGuidedCaptureEntryMeta(meta: GuidedCaptureEntryMeta): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(ENTRY_FILE, JSON.stringify(meta));
}

export async function clearGuidedCaptureEntryMeta(): Promise<void> {
  try {
    await FileSystem.deleteAsync(ENTRY_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
