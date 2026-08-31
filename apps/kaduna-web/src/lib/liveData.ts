// Live data layer: pulls recent incidents from the dispatch service and enriches
// each with a geo-intelligence impact score, adapting them to the dashboard's
// Incident shape. Any failure returns an empty list so the static dataset (loaded
// separately) still renders — the dashboard never goes blank.
import { scoreIncident } from "./geoScore";
import { recordScore } from "./scoreLog";
import { authHeaders } from "./supabase";
import type { Incident } from "./types";

const DISPATCH_URL = process.env.NEXT_PUBLIC_DISPATCH_URL ?? "http://localhost:3001";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DispatchIncident {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  createdAt?: string;
  assignedProvider?: { name: string; type: string } | null;
  triageResponse?: { predictedServiceType?: string } | null;
}

async function scoreOne(inc: DispatchIncident): Promise<Incident | null> {
  const at = inc.createdAt ? new Date(inc.createdAt) : new Date();
  const s = await scoreIncident({
    id: inc.id,
    latitude: inc.latitude,
    longitude: inc.longitude,
    serviceType: inc.triageResponse?.predictedServiceType,
    at,
  });
  if (!s) return null;
  const scored: Incident = {
    id: inc.id.slice(0, 8),
    lat: inc.latitude,
    lng: inc.longitude,
    // Whatever geo matched at the incident's coordinates, rather than the
    // placeholder this used to invent.
    roadType: s.road?.road_type ?? "primary",
    // Empty, not a placeholder: geo matches plenty of OSM ways that carry no
    // name tag, and "Live report" sitting in the road-name column of the
    // scoring log reads as though that were the road's name.
    roadName: s.road?.matched_road ?? "",
    totalLanes: s.road?.total_lanes ?? 2,
    lanesBlocked: s.lanesBlocked ?? 1,
    incidentType: s.incidentType,
    hour: s.hour,
    dayOfWeek: s.dayOfWeek,
    dayName: DAY_NAMES[s.dayOfWeek],
    impactScore: s.score,
    priority: s.priority,
    queueKm: s.prediction.queue_km ?? 0,
    vhl: s.prediction.vehicle_hours_lost ?? 0,
    recoveryMin: s.prediction.recovery_min ?? 0,
    clf: s.factors.capacity_loss ?? 0,
    tvf: s.factors.traffic_volume ?? 0,
    tf: s.factors.temporal ?? 0,
    lf: s.factors.location ?? 0,
    isf: s.factors.incident_severity ?? 0,
    live: true,
    providerName: inc.assignedProvider?.name ?? undefined,
    sensitivity: s.sensitivity
      ? {
          factor: s.sensitivity.factor,
          adjusted_score: s.sensitivity.adjusted_score,
          nearby: s.sensitivity.nearby,
          is_holiday: s.sensitivity.is_holiday,
          is_getaway_eve: s.sensitivity.is_getaway_eve,
        }
      : undefined,
  };
  recordScore(scored, s.road?.source ?? "default");
  return scored;
}

/** Recent live incidents from dispatch, each scored by geo. [] on any failure. */
export async function fetchLiveIncidents(): Promise<Incident[]> {
  try {
    const res = await fetch(`${DISPATCH_URL}/api/v1/incidents?limit=15`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const list: DispatchIncident[] = body?.data?.incidents ?? [];
    const scored = await Promise.all(list.map(scoreOne));
    return scored.filter((x): x is Incident => x !== null);
  } catch {
    return [];
  }
}
