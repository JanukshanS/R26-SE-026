import * as FileSystem from 'expo-file-system/legacy';

export type LocationSnapshotMeta = {
  capturedAtIso: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationPermission: 'granted' | 'denied' | 'unavailable';
  locationLabel: string | null;
  capturedAtDisplayLocal: string | null;
};

export function createLocationSnapshotStore(dir: string, filename: string) {
  const ROOT_DIR = (FileSystem.documentDirectory ?? '') + dir + '/';
  const STATE_FILE = ROOT_DIR + filename;

  return {
    async load(): Promise<LocationSnapshotMeta | null> {
      try {
        await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
        const info = await FileSystem.getInfoAsync(STATE_FILE);
        if (!info.exists) return null;
        const content = await FileSystem.readAsStringAsync(STATE_FILE);
        const parsed = JSON.parse(content) as Partial<LocationSnapshotMeta>;
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
          capturedAtDisplayLocal:
            typeof parsed.capturedAtDisplayLocal === 'string' ? parsed.capturedAtDisplayLocal : null,
        };
      } catch {
        return null;
      }
    },

    async save(meta: LocationSnapshotMeta): Promise<void> {
      await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
      await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(meta));
    },

    async clear(): Promise<void> {
      try {
        await FileSystem.deleteAsync(STATE_FILE, { idempotent: true });
      } catch {
        // best-effort
      }
    },
  };
}
