import { Platform } from "react-native";

import { authHeaders } from "@lib/capture-api";

const BASE_URL =
  process.env.EXPO_PUBLIC_MAINTENANCE_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000");

export type ComponentStatus = "Good" | "Fair" | "Poor" | "Critical" | "No data";
export type ComponentKey = "engine" | "brake" | "tire" | "battery";

/**
 * Health percentage below which the UI shows an alert banner and action bar.
 * Good (≥75%) and Fair (50–74%) are considered normal — no alarm.
 * Alert UI activates below this value. Does not apply to "No data" — that's
 * an absence of data, not a low score.
 */
export const ALERT_THRESHOLD_PCT = 35;

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
  trip_count: number;
  total_mileage_km: number;
  components: Record<ComponentKey, ComponentHealth>;
}

// Shape-only placeholder so a screen can render its "No data" state before the
// first response, or when the service is unreachable. Every figure is zero on
// purpose: an invented health percentage reads as a real reading to a driver.
export const EMPTY_HEALTH: VehicleHealthResponse = {
  vehicle_id: "",
  overall_health_pct: 0,
  overall_status: "No data",
  trip_count: 0,
  total_mileage_km: 0,
  components: {
    engine: { health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 150000 },
    brake: { health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 40000 },
    tire: { health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 50000 },
    battery: { health_pct: 0, status: "No data", predicted_rul_km: 0, max_lifespan_km: 80000 },
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
    trip_count: Number(raw?.trip_count) || 0,
    total_mileage_km: Number(raw?.total_mileage_km) || 0,
    components,
  };
}

export async function getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
  const { signal, cancel } = timeoutSignal(5000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/health`,
      { headers: await authHeaders(), signal }
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

// ── Service records ────────────────────────────────────────────────────────

export type ServiceType =
  | "replacement"
  | "initial_reading"
  | "oil_change"
  | "rotation"
  | "inspection"
  | "service"
  | "full_service"
  | "paint"
  | "system_fix"
  | "new_implementation";

export const SERVICE_TYPE_RESETS_WINDOW: Record<ServiceType, boolean> = {
  replacement: true,
  initial_reading: true,
  oil_change: false,
  rotation: false,
  inspection: false,
  service: false,
  full_service: false,
  paint: false,
  system_fix: false,
  new_implementation: false,
};

export interface ServiceRecordCreate {
  component: ComponentKey | "full_service";
  service_type: ServiceType;
  service_date: string;
  km_on_component?: number;
  item_name?: string;
  is_original?: "original" | "used";
  garage_name?: string;
  cost_lkr?: number;
  notes?: string;
}

export interface ServiceRecord {
  id: string;
  vehicle_id: string;
  component: string;
  service_type: string;
  service_date: string;
  km_on_component: number;
  item_name: string | null;
  is_original: string | null;
  garage_name: string | null;
  cost_lkr: number | null;
  notes: string | null;
  created_at: string;
}

export interface LatestServiceEntry {
  id: string;
  service_date: string;
  service_type: string;
  km_on_component: number;
  item_name: string | null;
  is_original: string | null;
  garage_name: string | null;
  cost_lkr: number | null;
  notes: string | null;
  resets_window: boolean;
}

export interface LatestServices {
  engine?: LatestServiceEntry;
  brake?: LatestServiceEntry;
  tire?: LatestServiceEntry;
  battery?: LatestServiceEntry;
}

export async function logService(vehicleId: string, data: ServiceRecordCreate): Promise<ServiceRecord> {
  const { signal, cancel } = timeoutSignal(8000);
  try {
    const res = await fetch(`${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/service`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ ...data, km_on_component: data.km_on_component ?? 0 }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail ?? `HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    cancel();
  }
}

export async function getLatestServices(vehicleId: string): Promise<LatestServices> {
  const { signal, cancel } = timeoutSignal(5000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/services/latest`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    cancel();
  }
}

export async function getServiceHistory(vehicleId: string): Promise<ServiceRecord[]> {
  const { signal, cancel } = timeoutSignal(5000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/services`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    cancel();
  }
}

// ── Trip batch (submit trip) ────────────────────────────────────────────────

export interface OBDReading {
  timestamp_offset_sec: number;
  rpm: number;
  speed_kmh: number;
  coolant_temp_c: number;
  battery_voltage_v: number;
  ltft_percent: number;
  throttle_percent: number;
  engine_load_percent: number;
  intake_air_temp_c: number;
}

export interface IMUReading {
  timestamp_offset_sec: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
}

export interface TripBatch {
  trip_id: string;
  vehicle_id: string;
  driver_id: string;
  start_timestamp: string;
  obd_readings: OBDReading[];
  imu_readings: IMUReading[];
}

export interface TripMetricsResponse {
  trip_id: string;
  vehicle_id: string;
  driver_id: string;
  start_timestamp: string;
  stored_at: string;
  duration_minutes: number;
  distance_km: number;
  avg_rpm: number;
  max_rpm: number;
  avg_engine_load: number;
  max_coolant_temp_c: number;
  ltft_std: number;
  braking_events: number;
  braking_frequency: number;
  avg_deceleration_intensity: number;
  cornering_events: number;
  cornering_frequency: number;
  avg_speed_kmh: number;
  total_mileage_km: number;
  avg_battery_voltage_v: number;
  min_battery_voltage_v: number;
  voltage_std: number;
  avg_iat_c: number;
}

export async function submitTrip(batch: TripBatch): Promise<TripMetricsResponse> {
  const { signal, cancel } = timeoutSignal(15000);
  try {
    const res = await fetch(`${BASE_URL}/process-trip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(batch),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail ?? `HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    cancel();
  }
}

// ── Trip summary ────────────────────────────────────────────────────────────

export interface TripSummary {
  trip_id: string;
  driver_id: string;
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

export interface VehicleTripSummary {
  vehicle_id: string;
  trip_count: number;
  total_distance_km: number;
  total_duration_minutes: number;
  avg_speed_kmh: number;
  avg_rpm: number;
  total_braking_events: number;
  total_cornering_events: number;
  latest_trip: string;
  trips: TripSummary[];
}

export async function getVehicleTripSummary(vehicleId: string): Promise<VehicleTripSummary | null> {
  const { signal, cancel } = timeoutSignal(6000);
  try {
    const res = await fetch(`${BASE_URL}/vehicles/summary`, {
      headers: await authHeaders(),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all: VehicleTripSummary[] = await res.json();
    return all.find((s) => s.vehicle_id === vehicleId) ?? null;
  } finally {
    cancel();
  }
}
