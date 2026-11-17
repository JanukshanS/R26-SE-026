// Predictive-maintenance client for the driver portal, ported from
// apps/mobile/lib/maintenanceApi.ts. The service keys every vehicle by its
// NUMBER PLATE (that is what the app sends with each trip), not by the
// vehicles.id uuid, so every call here takes the plate.
import { authHeaders } from "./supabase";
import type { Translate } from "./i18n";

const BASE_URL = process.env.NEXT_PUBLIC_MAINTENANCE_URL ?? "http://localhost:5000";

export type ComponentStatus = "Good" | "Fair" | "Poor" | "Critical" | "No data";
export type ComponentKey = "engine" | "brake" | "tire" | "battery";
export const COMPONENTS: ComponentKey[] = ["engine", "brake", "tire", "battery"];

export interface VehicleFault {
  code: string;
  title: string;
  component: ComponentKey | "other";
  severity: "urgent" | "soon" | "monitor";
  status: "confirmed" | "pending" | "permanent";
  likely_causes: string[];
  leads_to: string[];
  first_seen_at: string;
  last_seen_at: string;
  times_seen: number;
  recurrences: number;
  is_generic: boolean;
}

export interface ComponentHealth {
  health_pct: number;
  status: ComponentStatus;
  predicted_rul_km: number;
  max_lifespan_km: number;
}

export interface VehicleHealth {
  vehicle_id: string;
  overall_health_pct: number;
  overall_status: ComponentStatus;
  trip_count: number;
  total_mileage_km: number;
  components: Record<ComponentKey, ComponentHealth>;
  faults: VehicleFault[];
  /** False until a trip has completed a trouble-code read: "not checked" is not "no faults". */
  faults_checked: boolean;
}

/** The service could not be reached (or answered with an error), as opposed to "no data yet". */
export class MaintenanceOfflineError extends Error {
  constructor(message = "The vehicle health service isn't reachable right now.") {
    super(message);
    this.name = "MaintenanceOfflineError";
  }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; body: T | null }> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch {
    throw new MaintenanceOfflineError();
  }
  const body = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, body };
}

const key = (plate: string) => encodeURIComponent(plate);

// The service returns `components` as an array named for display; the UI wants all four keys.
const NAME_TO_KEY: Record<string, ComponentKey> = {
  Engine: "engine",
  "Brake Pads": "brake",
  Brakes: "brake",
  Brake: "brake",
  Tires: "tire",
  Tyres: "tire",
  Tire: "tire",
  Battery: "battery",
};
const VALID_STATUS: ComponentStatus[] = ["Good", "Fair", "Poor", "Critical", "No data"];
const status = (s: unknown): ComponentStatus => (VALID_STATUS.includes(s as ComponentStatus) ? (s as ComponentStatus) : "No data");
const blank = (): ComponentHealth => ({ health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 0 });

function normalizeHealth(raw: Record<string, unknown> | null, plate: string): VehicleHealth {
  const r = raw ?? {};
  const components: Record<ComponentKey, ComponentHealth> = { engine: blank(), brake: blank(), tire: blank(), battery: blank() };
  for (const c of Array.isArray(r.components) ? r.components : []) {
    const e = c as Record<string, unknown>;
    const k = NAME_TO_KEY[e.component as string];
    if (!k) continue;
    components[k] = {
      health_pct: Number(e.health_pct) || 0,
      status: status(e.status),
      predicted_rul_km: Number(e.predicted_rul_km) || 0,
      max_lifespan_km: Number(e.max_lifespan_km) || 0,
    };
  }
  return {
    vehicle_id: typeof r.vehicle_id === "string" ? r.vehicle_id : plate,
    overall_health_pct: Number(r.overall_health_pct) || 0,
    overall_status: status(r.overall_status),
    trip_count: Number(r.trip_count) || 0,
    total_mileage_km: Number(r.total_mileage_km) || 0,
    components,
    faults: Array.isArray(r.faults) ? (r.faults as VehicleFault[]) : [],
    faults_checked: Boolean(r.faults_checked),
  };
}

/**
 * Wear and live trouble codes for one vehicle. A vehicle with no trips is
 * normal and comes back with trip_count 0 (every part "No data"); only an
 * unreachable or failing service throws.
 */
export async function getVehicleHealth(plate: string): Promise<VehicleHealth> {
  // Not a lookup: it runs the models across four parts, so it gets a longer budget.
  const { status: code, body } = await call<Record<string, unknown>>(`/vehicle/${key(plate)}/health`, { timeoutMs: 30_000 });
  if (code === 404) return normalizeHealth(null, plate);
  if (code >= 400) throw new MaintenanceOfflineError();
  return normalizeHealth(body, plate);
}

/** True when the reading says something; false for a vehicle that hasn't driven a recorded trip. */
export const hasReading = (h: VehicleHealth | null | undefined): h is VehicleHealth => !!h && h.trip_count > 0;

// ─── Wording ─────────────────────────────────────────────────────────────

/** Rough time left on a part, in the driver's words. */
export function rulLabel(c: ComponentHealth, t: Translate): string {
  if (c.status === "No data") return t("me.health.rul.noData");
  if (c.status === "Good") return t("me.health.rul.healthy");
  const rul = c.predicted_rul_km;
  if (rul < 500) return t("me.health.rul.urgent");
  if (rul < 2000) return t("me.health.rul.week");
  if (rul < 4000) return t("me.health.rul.month");
  if (rul < 10000) return t("me.health.rul.km", { n: Math.round(rul / 1000) });
  return t(`me.health.status.${c.status}`);
}

/** Needs looking at: worn enough that the driver should act. */
export const needsAttention = (c: ComponentHealth) => c.status === "Poor" || c.status === "Critical";

// ─── Service records ─────────────────────────────────────────────────────

export type ServiceType =
  | "replacement"
  | "service"
  | "full_service"
  | "inspection"
  | "system_fix"
  | "new_implementation"
  | "paint"
  | "oil_change"
  | "rotation"
  | "initial_reading";

/** The kinds a driver logs by hand, in the order the form offers them. */
export const SERVICE_TYPES: ServiceType[] = ["replacement", "service", "full_service", "oil_change", "rotation", "inspection", "system_fix", "new_implementation", "paint"];

/** Only these restart a part's wear count; the form says so. */
export const RESETS_WEAR: Partial<Record<ServiceType, boolean>> = { replacement: true, initial_reading: true };

export type ServiceComponent = ComponentKey | "full_service";

export interface ServiceRecord {
  id: string;
  vehicle_id: string;
  component: string;
  service_type: string;
  service_date: string;
  created_at: string;
  km_on_component: number;
  odometer_km_at_service?: number | null;
  is_estimated?: boolean;
  item_name: string | null;
  is_original: string | null;
  garage_name: string | null;
  cost_lkr: number | null;
  notes: string | null;
}

export interface ServiceInput {
  component: ServiceComponent;
  service_type: ServiceType;
  service_date: string;
  item_name?: string;
  is_original?: "original" | "used";
  garage_name?: string;
  cost_lkr?: number;
  notes?: string;
}

export async function getServiceHistory(plate: string): Promise<ServiceRecord[]> {
  const { status: code, body } = await call<ServiceRecord[]>(`/vehicle/${key(plate)}/services`);
  if (code === 404) return [];
  if (code >= 400 || !Array.isArray(body)) throw new MaintenanceOfflineError();
  return body;
}

export async function logService(plate: string, input: ServiceInput): Promise<ServiceRecord> {
  const { status: code, body } = await call<ServiceRecord & { detail?: unknown }>(`/vehicle/${key(plate)}/service`, {
    method: "POST",
    body: JSON.stringify({ ...input, km_on_component: 0 }),
  });
  if (code >= 400) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : `The service record wasn't saved (HTTP ${code}).`);
  }
  return body as ServiceRecord;
}

// ─── Trips ───────────────────────────────────────────────────────────────

export interface TripSummary {
  trip_id: string;
  start_timestamp: string;
  duration_minutes: number;
  distance_km: number;
  avg_speed_kmh: number;
  avg_rpm: number;
  max_coolant_temp_c: number;
  braking_events: number;
  cornering_events: number;
  avg_battery_voltage_v: number;
}

export interface VehicleTrips {
  vehicle_id: string;
  trip_count: number;
  total_distance_km: number;
  total_duration_minutes: number;
  avg_speed_kmh: number;
  total_braking_events: number;
  total_cornering_events: number;
  latest_trip: string;
  trips: TripSummary[];
  has_more?: boolean;
  next_offset?: number | null;
}

export const TRIPS_PAGE = 20;

/** One page of trips, newest first; the totals always cover the whole history. Null when there are none. */
export async function getTrips(plate: string, offset = 0): Promise<VehicleTrips | null> {
  const { status: code, body } = await call<VehicleTrips>(`/vehicles/${key(plate)}/summary?limit=${TRIPS_PAGE}&offset=${offset}`);
  if (code === 404) return null;
  if (code >= 400 || !body) throw new MaintenanceOfflineError();
  return body;
}

// ─── Advice ──────────────────────────────────────────────────────────────

export interface ComponentAdvice {
  advice: {
    component: string;
    urgency: "critical" | "soon" | "monitor" | "healthy" | "unknown";
    headline: string;
    detail: string;
    actions: string[];
    reasons: string[];
    is_estimated: boolean;
  };
  text: string;
  source: "llm" | "fallback";
}

/** What to do about one part. The decision is made server-side so web and app never disagree. */
export async function getAdvice(plate: string, component: ComponentKey): Promise<ComponentAdvice | null> {
  try {
    const { status: code, body } = await call<ComponentAdvice>(`/vehicle/${key(plate)}/advice/${component}`, { timeoutMs: 20_000 });
    return code < 400 && body?.advice ? body : null;
  } catch {
    return null;
  }
}
