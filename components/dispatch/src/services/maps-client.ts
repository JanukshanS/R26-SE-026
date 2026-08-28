/**
 * Google Distance Matrix client.
 *
 * Replaces the Haversine-distance ÷ fixed-speed ETA estimate with real driving
 * time. Batched — ONE request covers every provider being evaluated against
 * the single incident location, matching the O(n×k) complexity the proposal
 * describes ("each involving a Maps API distance lookup (cached)"), not one
 * request per provider. Never throws to the caller: any failure (no key,
 * unreachable, over quota, a specific origin unresolvable) degrades to `null`
 * for the affected entries, and dispatch-optimizer.ts falls back to Haversine
 * per-provider for exactly those.
 */
import { config } from '../config';
import { logger } from '../utils/logger';
import { Location } from '../types';

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

/** Google caps a single Distance Matrix request at 25 origins (and 100
 *  origin×destination elements) — comfortably above the proposal's 5-50
 *  provider range, but guarded rather than assumed. */
const MAX_ORIGINS_PER_REQUEST = 25;

/** Real-world provider positions barely change minute to minute, and a demo
 *  or test run commonly re-evaluates the same incident location repeatedly —
 *  a short cache avoids paying for (and waiting on) the identical lookup
 *  twice, per the proposal's "cached" note on the Maps lookup. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { minutes: number; expiresAt: number }>();

function cacheKey(origin: Location, destination: Location): string {
  // Rounded to ~11m precision — enough to hit the cache for a provider who
  // hasn't materially moved, not so coarse that two different streets collapse.
  const r = (n: number) => n.toFixed(4);
  return `${r(origin.latitude)},${r(origin.longitude)}->${r(destination.latitude)},${r(destination.longitude)}`;
}

/**
 * Real driving time in minutes from each of `origins` to `destination`, in
 * the same order as `origins`. An entry is `null` when that specific leg
 * could not be resolved (Google returned a non-OK per-element status); the
 * whole array is `null` when the request itself failed (no key, network,
 * quota, timeout) — the caller falls back to Haversine either way, this
 * distinction is only for logging.
 */
export async function fetchRealTravelTimesMinutes(
  origins: Location[],
  destination: Location,
): Promise<(number | null)[] | null> {
  if (origins.length === 0) return [];
  if (!config.googleMapsApiKey) {
    logger.warn('GOOGLE_MAPS_API_KEY not configured; falling back to Haversine ETA for all providers');
    return null;
  }
  if (origins.length > MAX_ORIGINS_PER_REQUEST) {
    logger.warn(
      `${origins.length} providers exceeds Distance Matrix's ${MAX_ORIGINS_PER_REQUEST}-origin limit; falling back to Haversine ETA for all providers`,
    );
    return null;
  }

  // Cache check — only worth a request for the entries we don't already have.
  const results: (number | null)[] = new Array(origins.length).fill(null);
  const uncached: { index: number; origin: Location }[] = [];
  const now = Date.now();
  origins.forEach((origin, i) => {
    const hit = cache.get(cacheKey(origin, destination));
    if (hit && hit.expiresAt > now) {
      results[i] = hit.minutes;
    } else {
      uncached.push({ index: i, origin });
    }
  });
  if (uncached.length === 0) return results;

  const originsParam = uncached.map((o) => `${o.origin.latitude},${o.origin.longitude}`).join('|');
  const destinationsParam = `${destination.latitude},${destination.longitude}`;
  const url =
    `${DISTANCE_MATRIX_URL}?origins=${encodeURIComponent(originsParam)}` +
    `&destinations=${encodeURIComponent(destinationsParam)}` +
    `&mode=driving&departure_time=now&key=${config.googleMapsApiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      logger.warn(`Distance Matrix HTTP ${res.status}; falling back to Haversine ETA`);
      return null;
    }
    const data = (await res.json()) as {
      status: string;
      rows?: { elements: { status: string; duration_in_traffic?: { value: number }; duration?: { value: number } }[] }[];
    };
    if (data.status !== 'OK') {
      logger.warn(`Distance Matrix status ${data.status}; falling back to Haversine ETA`);
      return null;
    }

    uncached.forEach(({ index }, row) => {
      const element = data.rows?.[row]?.elements?.[0];
      if (element?.status === 'OK') {
        // Prefer live-traffic duration when Google has it for this route;
        // plain `duration` (no-traffic baseline) otherwise.
        const seconds = element.duration_in_traffic?.value ?? element.duration?.value;
        if (typeof seconds === 'number') {
          const minutes = seconds / 60;
          results[index] = minutes;
          cache.set(cacheKey(origins[index], destination), { minutes, expiresAt: now + CACHE_TTL_MS });
        }
      }
      // else: leave as null — that one leg falls back to Haversine below.
    });
    return results;
  } catch (err: any) {
    logger.warn(`Distance Matrix unreachable (${err?.message ?? err}); falling back to Haversine ETA`);
    return null;
  }
}
