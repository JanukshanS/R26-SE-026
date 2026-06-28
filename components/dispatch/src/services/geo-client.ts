/**
 * Geo-Intelligence client.
 *
 * Fetches the 1-10 traffic-impact score for an incident from the geo-intelligence
 * service so the ECM optimizer's externality term reflects real congestion impact
 * rather than a flat default. Never throws to the caller: returns null on any
 * failure so dispatch degrades gracefully when geo is unreachable.
 */
import { config } from '../config';
import { logger } from '../utils/logger';
import { ServiceTypeProbabilities } from '../types';

// Maps the dispatch ServiceType (triage's most-likely fault) onto the geo model's
// incident_type vocabulary. Unmapped types fall back to 'engine_failure'.
const SERVICE_TO_INCIDENT_TYPE: Record<string, string> = {
  MAJOR_ACCIDENT: 'major_accident',
  URGENT_TOW: 'major_accident',
  SEVERE_MECHANICAL_TOW: 'major_accident',
  FLOOD_RECOVERY: 'major_accident',
  FLAT_TIRE_CHANGE: 'flat_tire',
  FUEL_EMPTY: 'fuel_empty',
  FUEL_WRONG: 'fuel_empty',
  LOCKOUT: 'fuel_empty',
  KEY_LOST: 'fuel_empty',
  BATTERY_JUMP: 'battery_dead',
  BATTERY_TERMINAL_CLEAN: 'battery_dead',
  BATTERY_REPLACE: 'battery_dead',
  COOLANT_LOW: 'overheating',
  RADIATOR_FAN_ISSUE: 'overheating',
  RADIATOR_HOSE_LEAK: 'overheating',
  ENGINE_OVERHEAT_SEVERE: 'overheating',
};

function topServiceType(probabilities?: ServiceTypeProbabilities): string | undefined {
  const entries = Object.entries((probabilities ?? {}) as Record<string, number>);
  if (entries.length === 0) return undefined;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

export interface GeoScoreContext {
  latitude: number;
  longitude: number;
  probabilities?: ServiceTypeProbabilities;
}

export async function fetchTrafficImpactScore(ctx: GeoScoreContext): Promise<number | null> {
  const top = topServiceType(ctx.probabilities);
  const incidentType = (top && SERVICE_TO_INCIDENT_TYPE[top]) || 'engine_failure';
  const now = new Date();

  const body = {
    latitude: ctx.latitude,
    longitude: ctx.longitude,
    // Default road geometry until incidents carry a road class; the geo model
    // handles unknown roads with sane fallbacks and still varies by type/time.
    road_type: 'primary',
    total_lanes: 2,
    lanes_blocked: 1,
    incident_type: incidentType,
    hour: now.getHours(),
    day_of_week: (now.getDay() + 6) % 7, // JS Sun=0..Sat=6 -> model Mon=0..Sun=6
  };

  try {
    const res = await fetch(`${config.geoIntelligenceUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      logger.warn(`Geo score HTTP ${res.status}; falling back to default traffic score`);
      return null;
    }
    const data = (await res.json()) as { score?: number };
    return typeof data.score === 'number' ? data.score : null;
  } catch (err: any) {
    logger.warn(`Geo-intelligence unreachable (${err?.message ?? err}); falling back to default`);
    return null;
  }
}
