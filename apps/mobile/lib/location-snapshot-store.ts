import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';

import { formatGeocodedLine } from '@/lib/format-geocoded-line';
import { formatTimestamp } from '@/lib/format-timestamp';

/**
 * Web fallback: expo-file-system throws on web. The location snapshot
 * capture itself still runs (expo-location works on web via the browser
 * geolocation API), but persistence is a no-op — the returned store's
 * load/save/clear all short-circuit on web.
 */
const IS_WEB = Platform.OS === 'web';

export type LocationSnapshotMeta = {
  capturedAtIso: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationPermission: 'granted' | 'denied' | 'unavailable';
  locationLabel: string | null;
  capturedAtDisplayLocal: string | null;
};

/** One-shot "where/when" snapshot — requests foreground permission, reads the
 * current position, and reverse-geocodes it to a display label. Used at the
 * moment a feature's entry point is triggered (e.g. tapping into a flow, or
 * pressing record), not continuously. Never throws — falls back to a
 * permission/coords-less snapshot on any failure so callers can always save
 * something. */
export async function captureLocationSnapshot(): Promise<LocationSnapshotMeta> {
  const capturedAt = new Date();
  const base: LocationSnapshotMeta = {
    capturedAtIso: capturedAt.toISOString(),
    capturedAtDisplayLocal: formatTimestamp(capturedAt),
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    locationPermission: 'unavailable',
    locationLabel: null,
  };

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      base.locationPermission = 'denied';
      if (__DEV__) {
        console.log('[Location captured]', base);
      }
      return base;
    }
    base.locationPermission = 'granted';
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    base.latitude = pos.coords.latitude;
    base.longitude = pos.coords.longitude;
    base.accuracyMeters = pos.coords.accuracy ?? null;
    try {
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: base.latitude,
        longitude: base.longitude,
      });
      if (geo) {
        base.locationLabel = formatGeocodedLine(geo);
      }
    } catch {
      // keep null label
    }
  } catch {
    base.locationPermission = 'unavailable';
  }

  if (__DEV__) {
    console.log('[Location captured]', base);
  }
  return base;
}

export function createLocationSnapshotStore(dir: string, filename: string) {
  const ROOT_DIR = (FileSystem.documentDirectory ?? '') + dir + '/';
  const STATE_FILE = ROOT_DIR + filename;

  return {
    async load(): Promise<LocationSnapshotMeta | null> {
      if (IS_WEB) return null;
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
      if (IS_WEB) return;
      await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
      await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(meta));
    },

    async clear(): Promise<void> {
      if (IS_WEB) return;
      try {
        await FileSystem.deleteAsync(STATE_FILE, { idempotent: true });
      } catch {
        // best-effort
      }
    },
  };
}
