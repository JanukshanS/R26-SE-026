import * as FileSystem from 'expo-file-system/legacy';

export type ReportAccidentEntryMeta = {
  capturedAtIso: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationPermission: 'granted' | 'denied' | 'unavailable';
  locationLabel: string | null;
  capturedAtDisplayLocal: string | null;
};

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'report-accident/';
const STATE_FILE = ROOT_DIR + 'entry-meta.json';

export async function loadReportAccidentEntryMeta(): Promise<ReportAccidentEntryMeta | null> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(content) as Partial<ReportAccidentEntryMeta>;
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

export async function saveReportAccidentEntryMeta(meta: ReportAccidentEntryMeta): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(meta));
}

export async function clearReportAccidentEntryMeta(): Promise<void> {
  try {
    await FileSystem.deleteAsync(STATE_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
