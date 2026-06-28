import { Platform } from "react-native";

const BASE_URL =
  process.env.EXPO_PUBLIC_MAINTENANCE_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000");

export type ComponentStatus = "Good" | "Fair" | "Poor" | "Critical" | "No data";
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

// Hermes (RN's Android engine) lacks `AbortSignal.timeout`, so polyfill via
// AbortController + setTimeout — same pattern as the other API clients.
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

// The predictive service returns `components` as an ARRAY keyed by display name
// ("Engine", "Brake Pads", "Tires", "Battery") and reports "No data" for a
// vehicle with no recorded trips. The app wants an object keyed
// engine/brake/tire/battery with every key present — normalize here so no screen
// ever reads an undefined component.
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

function normalizeHealth(raw: any, vehicleId: string): VehicleHealthResponse {
  const components: Record<ComponentKey, ComponentHealth> = {
    engine: blankComponent(),
    brake: blankComponent(),
    tire: blankComponent(),
    battery: blankComponent(),
  };
  const arr = Array.isArray(raw?.components) ? raw.components : [];
  for (const c of arr) {
    const key = NAME_TO_KEY[c?.component as string];
    if (!key) continue;
    components[key] = {
      health_pct: Number(c?.health_pct) || 0,
      status: normalizeStatus(c?.status),
      predicted_rul_km: Number(c?.predicted_rul_km) || 0,
      max_lifespan_km: Number(c?.max_lifespan_km) || 0,
    };
  }
  return {
    vehicle_id: typeof raw?.vehicle_id === "string" ? raw.vehicle_id : vehicleId,
    overall_health_pct: Number(raw?.overall_health_pct) || 0,
    overall_status: normalizeStatus(raw?.overall_status),
    components,
  };
}

export async function getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
  const { signal, cancel } = timeoutSignal(5000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/health`,
      { signal }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeHealth(await res.json(), vehicleId);
  } finally {
    cancel();
  }
}

/** Convert RUL km → human label, e.g. "4 weeks", "Healthy", "No data" */
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

/** Urgency banner copy, e.g. "Action recommend in 4 weeks" */
export function rulToBanner(component: ComponentHealth): string {
  if (component.status === "No data") return "No trips recorded yet — drive to assess health";
  if (component.status === "Good") return "No action needed";
  const rul = component.predicted_rul_km;
  if (rul < 500) return "Action required immediately";
  if (rul < 2000) return "Action recommend in 1 week";
  if (rul < 4000) return "Action recommend in 4 weeks";
  return `Action recommend in ~${Math.round(rul / 2000)} months`;
}
