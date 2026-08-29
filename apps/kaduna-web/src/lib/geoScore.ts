// Geo-intelligence scoring client, shared by every surface that shows an
// incident: the ops dashboard's live layer, the provider's job card and the
// driver's incident card. One call, one cache, one wording.
import {
  mapServiceTypeToIncidentType,
  mapServiceTypeToLanesBlocked,
} from "./geo-service-mapping";
import { authHeaders } from "./supabase";

const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL ?? "http://localhost:5001";

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface GeoScore {
  score: number;
  priority: Priority;
  incidentType: string;
  /** Lanes assumed blocked, derived from the triaged service type. */
  lanesBlocked: number;
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
  /** Nearby hospitals, schools, bridges and markets, plus the calendar, which
   *  together lift the score above the five factors. */
  sensitivity?: {
    factor: number;
    adjusted_score: number;
    nearby: Array<{
      type: string;
      name?: string | null;
      distance_m?: number | null;
      boost: number;
      active: boolean;
    }>;
    is_holiday: boolean;
    is_getaway_eve: boolean;
    data_available: boolean;
  };
  /** Which road geo matched at these coordinates, and how it established it. */
  road?: {
    road_type: string;
    total_lanes: number;
    source: string;
    matched_road?: string | null;
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
 * Road class and lane count come back from geo, which resolves them from the
 * coordinates; only lanes-blocked stays an assumption, because the dispatch
 * incident record carries no lane data. The what-if simulator is where that
 * input is varied.
 */
export function scoreIncident(req: ScoreRequest): Promise<GeoScore | null> {
  const hour = req.at.getHours();
  const dayOfWeek = (req.at.getDay() + 6) % 7; // JS Sun=0..Sat=6 -> model Mon=0..Sun=6
  const key = `${req.id}:${hour}:${dayOfWeek}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const incidentType = mapServiceTypeToIncidentType(req.serviceType);
  const lanesBlocked = mapServiceTypeToLanesBlocked(req.serviceType);
  const pending = (async (): Promise<GeoScore | null> => {
    try {
      const res = await fetch(`${GEO_URL}/v1/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          latitude: req.latitude,
          longitude: req.longitude,
          // road_type and total_lanes are deliberately omitted: geo resolves
          // both from the coordinates against its OpenStreetMap network and
          // reports what it matched. Sending a guess pinned the Location
          // Factor at a constant for every live incident.
          lanes_blocked: lanesBlocked,
          incident_type: incidentType,
          hour,
          day_of_week: dayOfWeek,
          // Without a date the overlay cannot know about holidays or the eve
          // of a long weekend, so those components could never fire.
          date: req.at.toISOString().slice(0, 10),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const s = await res.json();
      return {
        score: s.score,
        priority: s.priority as Priority,
        incidentType,
        lanesBlocked,
        hour,
        dayOfWeek,
        factors: s.factors ?? {},
        prediction: s.prediction ?? {},
        road: s.road ?? undefined,
        sensitivity: s.sensitivity ?? undefined,
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
