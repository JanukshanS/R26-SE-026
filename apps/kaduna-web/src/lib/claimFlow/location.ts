import { loadGoogleMaps } from "@/lib/googleMaps";
import type { LocationSnapshot } from "./types";

const GEOCODE_TIMEOUT_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function coordLabel(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

/** Best-effort human-readable label via the Google Maps JS Geocoder (already loaded
 * for the map picker elsewhere in this app) — falls back to raw coordinates on any
 * failure or timeout, same "never block on this" rule as the app's reverse-geocode. */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const maps = await withTimeout(loadGoogleMaps(), GEOCODE_TIMEOUT_MS);
    const geocoder = new maps.Geocoder();
    const result = await withTimeout(
      new Promise<string | null>((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results: any, status: any) => {
          if (status === "OK" && results && results[0]) {
            resolve(results[0].formatted_address);
          } else {
            resolve(null);
          }
        });
      }),
      GEOCODE_TIMEOUT_MS
    );
    return result ?? coordLabel(lat, lng);
  } catch {
    return coordLabel(lat, lng);
  }
}

export type PhotoGps = {
  lat: number;
  lng: number;
  accuracy: number | null;
};

/**
 * Fast, per-photo GPS fix — no reverse geocoding (that's for the three
 * claim-level location snapshots only). Mirrors apps/mobile's
 * lib/snap-photo-gps.ts: best-effort, never throws, returns null on denial/
 * timeout/unavailability so a photo still uploads without GPS rather than
 * blocking. `maximumAge` lets the browser hand back a very recent cached fix
 * instead of always forcing a fresh cold lock, which is what keeps this fast
 * enough to call once per photo across a 36-shot walkaround.
 */
export async function getCurrentCoords(): Promise<PhotoGps | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return null;
  }
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 10000,
      });
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}

/** One-shot "where/when" snapshot, mirroring apps/mobile's
 * lib/location-snapshot-store.ts::captureLocationSnapshot() — used at Call
 * Insurer, Guided Capture entry, and just before submit. Never throws. */
export async function captureLocationSnapshot(): Promise<LocationSnapshot> {
  const capturedAt = new Date();
  const base: LocationSnapshot = {
    capturedAtIso: capturedAt.toISOString(),
    capturedAtDisplayLocal: capturedAt.toLocaleString(),
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    locationPermission: "unavailable",
    locationLabel: null,
  };

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return base;
  }

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
      });
    });
    base.locationPermission = "granted";
    base.latitude = pos.coords.latitude;
    base.longitude = pos.coords.longitude;
    base.accuracyMeters = pos.coords.accuracy ?? null;
    base.locationLabel = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    base.locationPermission = code === 1 ? "denied" : "unavailable";
  }

  return base;
}
