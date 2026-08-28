import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * The resolved GPS/location line for the current claim, cached the moment it's first
 * resolved (GPS fetch + reverse-geocode) so a later re-entry into the upload screen —
 * reopening the app, resuming an interrupted upload, the reminder modal's "Resume Now"
 * — can skip that whole resolution step entirely instead of redoing it (and re-showing
 * "Getting location…") every single time.
 *
 * This also matters functionally, not just cosmetically: Location.reverseGeocodeAsync
 * has no timeout of its own, so on a flaky/offline connection it can hang indefinitely —
 * and the actual upload doesn't start until location resolution finishes. Skipping
 * re-resolution on repeat visits means a slow/hanging reverse-geocode call only ever
 * blocks the very first attempt, not every subsequent one.
 */
const IS_WEB = Platform.OS === 'web';

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const LOCATION_CACHE_FILE = ROOT_DIR + 'claim-location-cache.json';

export type ClaimLocationCache = {
  uploadKey: string;
  lat: number;
  lng: number;
  locationLine: string;
  timestampLine: string;
};

export async function saveClaimLocationCache(cache: ClaimLocationCache): Promise<void> {
  if (IS_WEB) return;
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(LOCATION_CACHE_FILE, JSON.stringify(cache));
}

/** Returns the cached location only if it belongs to the exact same claim — a different
 * uploadKey (new claim, or retaken photos) means this cache no longer applies. */
export async function loadClaimLocationCache(uploadKey: string): Promise<ClaimLocationCache | null> {
  if (IS_WEB) return null;
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(LOCATION_CACHE_FILE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(LOCATION_CACHE_FILE)) as Partial<ClaimLocationCache>;
    if (
      typeof parsed.uploadKey !== 'string' ||
      typeof parsed.lat !== 'number' ||
      typeof parsed.lng !== 'number' ||
      typeof parsed.locationLine !== 'string' ||
      typeof parsed.timestampLine !== 'string'
    ) {
      return null;
    }
    if (parsed.uploadKey !== uploadKey) {
      return null;
    }
    return {
      uploadKey: parsed.uploadKey,
      lat: parsed.lat,
      lng: parsed.lng,
      locationLine: parsed.locationLine,
      timestampLine: parsed.timestampLine,
    };
  } catch {
    return null;
  }
}

export async function clearClaimLocationCache(): Promise<void> {
  if (IS_WEB) return;
  try {
    await FileSystem.deleteAsync(LOCATION_CACHE_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
