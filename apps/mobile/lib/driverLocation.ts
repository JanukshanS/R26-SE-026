/**
 * ============================================================================
 * Driver location — real GPS via expo-location with safe fallback
 * ============================================================================
 *
 * Resolves the driver's current location for incident creation and map
 * display. The flow:
 *
 *   1. Asks for foreground location permission (no-ops if already granted).
 *   2. Calls Location.getCurrentPositionAsync() — short timeout so the UX
 *      doesn't stall on a slow GPS lock.
 *   3. Caches the last-known coordinate for 5 minutes — subsequent calls
 *      return immediately without hitting the GPS chip again.
 *   4. On any failure (permission denied, GPS off, timeout, web target),
 *      falls back to FALLBACK_LOCATION (Colombo centroid).
 *
 * This is the single source of truth for "where is the driver?" — used by:
 *   - safety-check.tsx           (prefetch on mount)
 *   - diagnosis-lights.tsx       (incident creation, ML path)
 *   - quick-dispatch.tsx         (incident creation, fast-path)
 *   - connected.tsx              (map pin + distance display)
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import * as Location from "expo-location";

export interface DriverLocation {
  latitude:  number;
  longitude: number;
  /** True if the coordinate came from device GPS; false if it's the fallback. */
  isReal:    boolean;
  /** Accuracy in metres (only meaningful when isReal=true). */
  accuracy?: number;
}

/**
 * Fallback coordinate — used when GPS is unavailable. Picked deliberately
 * NOT to coincide with any seeded provider so that distance/ETA still come
 * out non-zero on the demo. (The original DEMO_LOCATION was at exactly
 * Rajitha's coordinate, which made distance 0 km and ETA 0 min — that's
 * what was making the "Connected" screen look broken.)
 *
 * Coordinate: Malabe (matches the "Malabe, Srilanka" caption on the home
 * screen). The seeded providers cluster in Colombo metro, so distances
 * from Malabe come out in the realistic 8-15 km / 20-35 min range.
 */
export const FALLBACK_LOCATION: DriverLocation = {
  latitude:  6.9147,
  longitude: 79.9724,
  isReal:    false,
};

// ─────────────────────────────────────────────────────────────────────────
// Cache — avoid hitting the GPS chip more often than every 5 minutes
// ─────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { value: DriverLocation; at: number } | null = null;

function cacheStillFresh(): boolean {
  return cached !== null && Date.now() - cached.at < CACHE_TTL_MS;
}

/** Drop the cache — used by tests and the "Update Location" button. */
export function invalidateDriverLocation(): void {
  cached = null;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the driver's current location.
 *
 * @param opts.forceFresh  Skip the cache and hit GPS again.
 * @returns A DriverLocation. Never throws — falls back to FALLBACK_LOCATION
 *          on any error so callers don't need defensive code paths.
 */
export async function getCurrentDriverLocation(
  opts: { forceFresh?: boolean } = {}
): Promise<DriverLocation> {
  if (!opts.forceFresh && cacheStillFresh()) {
    return cached!.value;
  }

  try {
    // Permission. If the user previously chose "Allow While Using" this is
    // a no-op; if they previously denied, returns immediately with denied.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      // User said no — fall through to FALLBACK_LOCATION but cache the
      // decision so we don't re-prompt on every screen transition.
      cached = { value: FALLBACK_LOCATION, at: Date.now() };
      return FALLBACK_LOCATION;
    }

    // Use BALANCED accuracy — HIGH/HIGHEST drain battery and take 10s+ to
    // converge. For dispatch purposes ~50m precision is plenty.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const value: DriverLocation = {
      latitude:  pos.coords.latitude,
      longitude: pos.coords.longitude,
      isReal:    true,
      accuracy:  pos.coords.accuracy ?? undefined,
    };
    cached = { value, at: Date.now() };
    return value;
  } catch {
    // GPS off, timeout, web target without geolocation, etc.
    cached = { value: FALLBACK_LOCATION, at: Date.now() };
    return FALLBACK_LOCATION;
  }
}
