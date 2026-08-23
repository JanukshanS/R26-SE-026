// Live data layer: pulls recent incidents from the dispatch service and enriches
// each with a geo-intelligence impact score, adapting them to the dashboard's
// Incident shape. Any failure returns an empty list so the static dataset (loaded
// separately) still renders — the dashboard never goes blank.
import { scoreIncident } from "./geoScore";
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
  return {
    id: inc.id.slice(0, 8),
    lat: inc.latitude,
    lng: inc.longitude,
    roadType: "primary",
    roadName: "Live report",
    totalLanes: 2,
    lanesBlocked: 1,
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
  };
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
