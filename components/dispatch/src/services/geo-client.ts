/**
 * Geo-Intelligence client.
 *
 * Fetches the 1-10 traffic-impact score for an incident from the geo-intelligence
 * service so the ECM optimizer's externality term reflects real congestion impact
 * rather than a flat default. Never throws to the caller: it degrades gracefully,
 * returning `'geo-unavailable'` when geo answered with an error status (a reached
 * but refusing service, e.g. 503 from a deploy missing SUPABASE_URL) and null when
 * it could not be reached at all (timeout, connection refused).
 */
import {
  mapServiceTypeToIncidentType,
  mapServiceTypeToLanesBlocked,
} from '../contracts/geo-service-mapping';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ServiceTypeProbabilities } from '../types';

/** A score, or the reason there isn't one. */
export type GeoScoreResult = number | 'geo-unavailable' | null;

const COLOMBO_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Local time in Asia/Colombo as the model's hour and Mon=0 weekday. The process
 * clock is UTC in the container, and reading it directly inverts the peak-hour
 * signal (08:00 Colombo would be sent as hour 2) and rolls the weekday back
 * before 05:30. ICU carries the tz database, so no Alpine package is needed;
 * the arithmetic fallback covers a runtime whose ICU cannot resolve the zone.
 */
function colomboNow(): { hour: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());

  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const dayOfWeek = COLOMBO_WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && dayOfWeek >= 0) {
    return { hour, dayOfWeek };
  }

  // Sri Lanka has observed a fixed UTC+05:30 with no DST since 2006.
  const shifted = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return { hour: shifted.getUTCHours(), dayOfWeek: (shifted.getUTCDay() + 6) % 7 };
}

function topServiceType(probabilities?: ServiceTypeProbabilities): string | undefined {
  const entries = Object.entries((probabilities ?? {}) as Record<string, number>);
  if (entries.length === 0) return undefined;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

export interface GeoScoreContext {
  latitude: number;
  longitude: number;
  probabilities?: ServiceTypeProbabilities;
  /**
   * The caller's `Authorization` header, forwarded verbatim. Geo-intelligence
   * requires a bearer token, and passing the caller's through means this
   * service holds no credentials of its own.
   */
  authorization?: string;
}

export async function fetchTrafficImpactScore(ctx: GeoScoreContext): Promise<GeoScoreResult> {
  const top = topServiceType(ctx.probabilities);
  const colombo = colomboNow();

  const body = {
    latitude: ctx.latitude,
    longitude: ctx.longitude,
    // Default road class and lane count until incidents carry one; that needs an
    // OSM lookup. Lanes blocked is derived from the triaged service type so the
    // capacity-loss factor is not frozen along with them.
    road_type: 'primary',
    total_lanes: 2,
    lanes_blocked: mapServiceTypeToLanesBlocked(top),
    incident_type: mapServiceTypeToIncidentType(top),
    hour: colombo.hour,
    day_of_week: colombo.dayOfWeek,
  };

  try {
    const res = await fetch(`${config.geoIntelligenceUrl}/v1/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.authorization ? { Authorization: ctx.authorization } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      logger.warn(
        `Geo score HTTP ${res.status}; geo reached but refused, falling back to default traffic score`,
      );
      return 'geo-unavailable';
    }
    const data = (await res.json()) as { score?: number };
    return typeof data.score === 'number' ? data.score : null;
  } catch (err: any) {
    logger.warn(`Geo-intelligence unreachable (${err?.message ?? err}); falling back to default`);
    return null;
  }
}
