/**
 * Driving route between the incident and the assigned provider, for the map on
 * the connected screen.
 *
 * OSRM rather than Google Directions: a Google API key restricted to an Android
 * app cannot call web-service APIs, and Directions is one. Using it would mean
 * either shipping a second, unrestricted key inside the APK — where anyone can
 * read it — or proxying every request through dispatch. OSRM needs no key.
 * ponytail: public demo server, no SLA and rate limited. Move behind a dispatch
 * proxy (or Google Directions with a server-side key) if this carries real load.
 *
 * Returns null on any failure. The caller falls back to a straight line, so a
 * routing outage degrades the map rather than breaking it.
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const TIMEOUT_MS = 6000;

/** GeoJSON geometry, not the encoded polyline: it needs no decoder. */
export async function fetchDrivingRoute(
  from: LatLng,
  to: LatLng,
): Promise<LatLng[] | null> {
  const pair = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = `${OSRM_URL}/${pair}?overview=full&geometries=geojson`;

  // AbortController rather than AbortSignal.timeout: Hermes does not ship the
  // latter, and a hung request would leave the map on the straight line forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    // OSRM emits [longitude, latitude]; react-native-maps wants the reverse.
    return line.map(([lng, lat]: [number, number]) => ({
      latitude: lat,
      longitude: lng,
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
