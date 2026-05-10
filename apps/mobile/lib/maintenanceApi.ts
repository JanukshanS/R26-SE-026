import { Platform } from "react-native";

const BASE_URL =
  Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000";

export type ComponentStatus = "Good" | "Fair" | "Poor" | "Critical";
export type ComponentKey = "engine" | "brake" | "tire" | "battery";

export interface ComponentHealth {
  health_pct: number;
  status: ComponentStatus;
  predicted_rul_km: number;
  max_lifespan_km: number;
}

export interface VehicleHealthResponse {
  vehicle_id: string;
  overall_health_pct: number;
  overall_status: ComponentStatus;
  components: Record<ComponentKey, ComponentHealth>;
}

export const FALLBACK_HEALTH: VehicleHealthResponse = {
  vehicle_id: "CBD-3742",
  overall_health_pct: 87,
  overall_status: "Good",
  components: {
    engine: { health_pct: 72, status: "Fair", predicted_rul_km: 7200, max_lifespan_km: 150000 },
    brake: { health_pct: 58, status: "Fair", predicted_rul_km: 1800, max_lifespan_km: 40000 },
    tire: { health_pct: 95, status: "Good", predicted_rul_km: 47500, max_lifespan_km: 50000 },
    battery: { health_pct: 88, status: "Good", predicted_rul_km: 70400, max_lifespan_km: 80000 },
  },
};

export async function getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
  const res = await fetch(
    `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/health`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<VehicleHealthResponse>;
}

/** Convert RUL km → human label, e.g. "4 weeks", "Healthy" */
export function rulToLabel(component: ComponentHealth): string {
  if (component.status === "Good") return "Healthy";
  const rul = component.predicted_rul_km;
  if (rul < 500) return "Urgent";
  if (rul < 2000) return "~1 week";
  if (rul < 4000) return "~4 weeks";
  if (rul < 10000) return `${Math.round(rul / 1000)}k km`;
  return "Healthy";
}

/** Urgency banner copy, e.g. "Action recommend in 4 weeks" */
export function rulToBanner(component: ComponentHealth): string {
  if (component.status === "Good") return "No action needed";
  const rul = component.predicted_rul_km;
  if (rul < 500) return "Action required immediately";
  if (rul < 2000) return "Action recommend in 1 week";
  if (rul < 4000) return "Action recommend in 4 weeks";
  return `Action recommend in ~${Math.round(rul / 2000)} months`;
}
