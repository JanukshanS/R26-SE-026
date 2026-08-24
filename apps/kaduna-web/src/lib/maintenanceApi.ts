// Predictive-maintenance client for the driver portal. Ported from
// apps/mobile/lib/maintenanceApi.ts, trimmed to the one endpoint the portal
// reads: GET /vehicle/{id}/health. Mobile's service-record calls
// (POST /vehicle/{id}/service, GET /vehicle/{id}/services, /services/latest)
// are deliberately NOT ported — those routes do not exist in
// components/predictive-maintenance and answer 404.
import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_MAINTENANCE_URL ?? "http://localhost:5000";

export type ComponentStatus = "Good" | "Fair" | "Poor" | "Critical" | "No data";
export type ComponentKey = "engine" | "brake" | "tire" | "battery";

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
}

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  engine: "Engine",
  brake: "Brakes",
  tire: "Tires",
  battery: "Battery",
};

// The service returns `components` as an ARRAY keyed by display name; the UI
// wants an object with all four keys present. Same normalization as mobile.
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

function normalizeStatus(s: unknown): ComponentStatus {
  return VALID_STATUS.includes(s as ComponentStatus) ? (s as ComponentStatus) : "No data";
}

function blankComponent(): ComponentHealth {
  return { health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 0 };
}

function normalizeHealth(raw: unknown, vehicleId: string): VehicleHealth {
  const r = (raw ?? {}) as Record<string, unknown>;
  const components: Record<ComponentKey, ComponentHealth> = {
    engine: blankComponent(),
    brake: blankComponent(),
    tire: blankComponent(),
    battery: blankComponent(),
  };
  for (const c of Array.isArray(r.components) ? r.components : []) {
    const entry = c as Record<string, unknown>;
    const key = NAME_TO_KEY[entry.component as string];
    if (!key) continue;
    components[key] = {
      health_pct: Number(entry.health_pct) || 0,
      status: normalizeStatus(entry.status),
      predicted_rul_km: Number(entry.predicted_rul_km) || 0,
      max_lifespan_km: Number(entry.max_lifespan_km) || 0,
    };
  }
  return {
    vehicle_id: typeof r.vehicle_id === "string" ? r.vehicle_id : vehicleId,
    overall_health_pct: Number(r.overall_health_pct) || 0,
    overall_status: normalizeStatus(r.overall_status),
    trip_count: Number(r.trip_count) || 0,
    total_mileage_km: Number(r.total_mileage_km) || 0,
    components,
  };
}

/**
 * Health summary for one vehicle, or null when there is nothing to show.
 *
 * A vehicle with no telemetry is the common case and is NOT an error: the
 * service answers 200 with every status "No data". Unreachable service, 404
 * and 503 (models not loaded) collapse to the same null so the portal shows
 * "no telemetry yet" rather than a scary failure card.
 */
export async function getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/health`, {
      headers: await authHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const health = normalizeHealth(await res.json().catch(() => ({})), vehicleId);
  return health.trip_count > 0 ? health : null;
}

/** RUL km → human label, matching mobile's wording. */
export function rulToLabel(component: ComponentHealth): string {
  if (component.status === "No data") return "No data";
  if (component.status === "Good") return "Healthy";
  const rul = component.predicted_rul_km;
  if (rul < 500) return "Urgent";
  if (rul < 2000) return "~1 week";
  if (rul < 4000) return "~4 weeks";
  if (rul < 10000) return `${Math.round(rul / 1000)}k km`;
  return "Healthy";
}
