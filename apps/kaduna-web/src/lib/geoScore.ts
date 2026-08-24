// Geo-intelligence scoring client, shared by every surface that shows an
// incident: the ops dashboard's live layer, the provider's job card and the
// driver's incident card. One call, one cache, one wording.
import { mapServiceTypeToIncidentType } from "./geo-service-mapping";
import { authHeaders } from "./supabase";

const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL ?? "http://localhost:5001";

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface GeoScore {
  score: number;
  priority: Priority;
  incidentType: string;
  hour: number;
  dayOfWeek: number;
  factors: {
    capacity_loss?: number;
    traffic_volume?: number;
    temporal?: number;
    location?: number;
    incident_severity?: number;
  };
  prediction: {
    queue_km?: number;
    vehicle_hours_lost?: number;
    recovery_min?: number;
  };
}

export interface ScoreRequest {
  /** Only used as the cache key; the geo service never sees it. */
  id: string;
  latitude: number;
  longitude: number;
  /** Triage's predicted service type, mapped to a geo incident type. */
  serviceType?: string;
  /**
   * When the incident happened. Scoring is time-of-day sensitive, so passing
   * the incident's own createdAt keeps a historical card's number stable
   * instead of drifting every time the page polls.
   */
  at: Date;
}

/**
 * Cached in-flight and settled scores, keyed by incident and hour. The
 * provider console polls every 5s and the driver portal every 10s; without
 * this each poll would re-POST /v1/score for every row on screen.
 */
const cache = new Map<string, Promise<GeoScore | null>>();

/**
 * Impact score for one incident, or null if geo is unreachable. Never throws:
 * the score is decoration on every surface that shows it, and a card must
 * still render when the service is down.
 *
 * Road geometry is a fixed assumption (a two-lane primary road with one lane
 * blocked) because the dispatch incident record carries no road data. The
 * dashboard's what-if simulator is where those inputs are varied.
 */
export function scoreIncident(req: ScoreRequest): Promise<GeoScore | null> {
  const hour = req.at.getHours();
  const dayOfWeek = (req.at.getDay() + 6) % 7; // JS Sun=0..Sat=6 -> model Mon=0..Sun=6
  const key = `${req.id}:${hour}:${dayOfWeek}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const incidentType = mapServiceTypeToIncidentType(req.serviceType);
  const pending = (async (): Promise<GeoScore | null> => {
    try {
      const res = await fetch(`${GEO_URL}/v1/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          latitude: req.latitude,
          longitude: req.longitude,
          road_type: "primary",
          total_lanes: 2,
          lanes_blocked: 1,
          incident_type: incidentType,
          hour,
          day_of_week: dayOfWeek,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const s = await res.json();
      return {
        score: s.score,
        priority: s.priority as Priority,
        incidentType,
        hour,
        dayOfWeek,
        factors: s.factors ?? {},
        prediction: s.prediction ?? {},
      };
    } catch {
      return null;
    }
  })();

  cache.set(key, pending);
  // A failed call must not be cached as a permanent "no score" — the geo
  // service coming back up should heal the next poll.
  pending.then((v) => {
    if (v === null) cache.delete(key);
  });
  return pending;
}
