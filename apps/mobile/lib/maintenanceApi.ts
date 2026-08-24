import { Platform } from "react-native";

import { authHeaders } from "@lib/capture-api";
import type { TripBehavior } from "@lib/driverBehavior";

export type { TripBehavior };

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

/**
 * Shape-only placeholder so a screen can render its "No data" state before the
 * first response resolves, or when the service is unreachable. In both cases
 * there is no confirmed health for this vehicle, so this mirrors the backend's
 * OWN response for a vehicle with zero recorded trips (health_pct=0,
 * status="No data") rather than inventing a plausible-looking number.
 *
 * This used to be a fabricated 87% overall / 72% engine / 58% brake — numbers
 * chosen to look like real output, indistinguishable on screen from an actual
 * reading. A network blip would silently draw a full health card with invented
 * percentages, alert pills for wear that was never measured, and a "Good"
 * badge for a car the app had no data on. Every screen that renders this
 * already branches on `status === "No data"` and shows "—" for it, so
 * representing "we don't know" honestly costs nothing.
 */
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
  /**
   * "user"    - km_on_component is what the driver told us.
   * "unknown" - the driver said "not sure"; the server ignores km_on_component
   *             and works out the install point from the odometer instead.
   * Left to the server on purpose so the "assume it was serviced on schedule"
   * rule lives in exactly one place and can't drift between app and backend.
   */
  basis?: "user" | "unknown";
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
  /** Wall-clock end. Authoritative for duration when it agrees with the offsets. */
  end_timestamp?: string;
  /** 2 = real timestamp offsets + behaviour block. Absent = legacy client. */
  client_schema_version?: number;
  /**
   * Driver-behaviour metrics computed on-device from the raw 4 Hz IMU stream
   * (steering reversals, swerves, harsh events, jerk). Optional so older app
   * builds keep working against the same endpoint.
   */
  behavior?: TripBehavior;
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

/**
 * Thrown by `submitTrip` when the backend answers but refuses the batch.
 *
 * The status code is carried alongside the message because the disposition of
 * a failed submission depends entirely on it and NOT on the prose: `/process-trip`
 * answers 409 for a trip it already stored (which means the batch landed — a
 * success from the client's point of view) and 422 for one it will never accept
 * (too short), while a 5xx or a dropped connection is worth retrying forever.
 * `pendingTripStore.ts` has to tell those apart without an outage, so
 * string-matching `detail` was never going to hold — the backend is free to
 * reword it.
 *
 * `message` is still the backend's `detail`, so existing `err?.message` call
 * sites (the manual end-trip alert) are unchanged.
 */
export class TripSubmitError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TripSubmitError";
    this.status = status;
  }
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
      throw new TripSubmitError(res.status, (err as any).detail ?? `HTTP ${res.status}`);
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
  /** Present only on the per-vehicle endpoint. */
  has_more?: boolean;
  next_offset?: number | null;
}

/** Trips per request. Enough to fill a screen without a huge first payload. */
export const TRIPS_PAGE_SIZE = 20;

/**
 * One vehicle's trip history, a page at a time, newest first.
 *
 * This used to GET /vehicles/summary — which returns every trip of EVERY
 * vehicle — and then `.find()` the one it wanted, so rendering a single
 * vehicle's screen downloaded the whole fleet's history and discarded almost
 * all of it. Fine with a handful of trips; not fine once a vehicle has a few
 * hundred, which the simulated-history feature makes trivial to produce. The
 * payload grew with every trip anyone recorded, on any car.
 *
 * The aggregates on the response always describe the FULL history regardless
 * of paging — only `trips` is windowed — so totals don't shift as you scroll.
 *
 * Returns null when the vehicle has no trips at all (the server answers 404),
 * which callers already treat as the empty state.
 */
export async function getVehicleTripSummary(
  vehicleId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<VehicleTripSummary | null> {
  const limit = opts.limit ?? TRIPS_PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const { signal, cancel } = timeoutSignal(10000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicles/${encodeURIComponent(vehicleId)}/summary?limit=${limit}&offset=${offset}`,
      { headers: await authHeaders(), signal }
    );
    // No trips recorded yet — an empty state, not a failure.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    cancel();
  }
}


// ── Vehicle registration baseline ──────────────────────────────────────────
// What the odometer read, and what condition each part was in, at the moment
// the driver added the car. Set ONCE at registration and never editable after:
// it is a statement about the vehicle's history, and letting it move would let
// someone quietly rewrite their maintenance position. Servicing done later is
// recorded as normal service records.

export type VehicleCondition = "new" | "used";

export interface ComponentLifespans {
  expected_life_km: Record<string, number>;
  wear_components: string[];
  engine_oil_interval_km: number;
}

/** Expected life per component, so the registration screens can preview an
 *  estimate without reimplementing the server's rule. */
export async function getComponentLifespans(): Promise<ComponentLifespans | null> {
  const { signal, cancel } = timeoutSignal(6000);
  try {
    const res = await fetch(`${BASE_URL}/components/lifespans`, {
      headers: await authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ComponentLifespans;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/** What the driver said about one component at registration. */
export type ComponentBaselineInput =
  | { known: true; installKm: number }   // "replaced at X km"
  | { known: false };                    // "not sure" - the server estimates

export interface VehicleBaselineInput {
  odometerKm: number;
  condition: VehicleCondition;
  /** Only for a used vehicle; omitted keys are estimated server-side anyway. */
  components?: Partial<Record<ComponentKey, ComponentBaselineInput>>;
}

/**
 * Register the vehicle's starting condition. Best-effort by design: the server
 * re-derives an estimate from the odometer at request time, so a dropped call
 * costs the audit trail, not the health numbers.
 *
 * Returns true when the baseline itself was stored.
 */
export async function registerVehicleBaseline(
  vehicleId: string,
  input: VehicleBaselineInput
): Promise<boolean> {
  const { signal, cancel } = timeoutSignal(8000);
  let baselineOk = false;
  try {
    const res = await fetch(`${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/baseline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ odometer_km: input.odometerKm, condition: input.condition }),
      signal,
    });
    // 409 means it was already registered. Not an error to surface: the record
    // is immutable, so "already set" is the correct end state.
    baselineOk = res.ok || res.status === 409;
    if (!baselineOk) {
      console.log(`[baseline] PUT failed (${res.status}) for ${vehicleId}`);
    }
  } catch (e) {
    console.log(`[baseline] PUT threw for ${vehicleId}: ${e instanceof Error ? e.message : e}`);
  } finally {
    cancel();
  }

  if (input.condition !== "used" || !input.components) return baselineOk;

  const today = new Date().toISOString().slice(0, 10);
  for (const [component, answer] of Object.entries(input.components)) {
    if (!answer) continue;
    try {
      await logService(vehicleId, {
        component: component as ComponentKey,
        service_type: "initial_reading",
        service_date: today,
        km_on_component: answer.known ? Math.max(input.odometerKm - answer.installKm, 0) : 0,
        basis: answer.known ? "user" : "unknown",
      });
    } catch (e) {
      // Keep going: one failed component must not block the others, and the
      // server estimates anything missing at request time regardless.
      console.log(`[baseline] ${component} initial reading failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return baselineOk;
}

/**
 * Mirror of the server's "assume it was serviced on schedule" rule, used ONLY
 * to preview an estimate while the driver is still filling the form. The stored
 * answer always comes from the server - this never writes anything.
 */
export function previewInstallKm(
  odometerKm: number,
  expectedLifeKm: number
): { installKm: number; kmOnComponent: number } {
  if (expectedLifeKm <= 0 || odometerKm <= 0) return { installKm: 0, kmOnComponent: Math.max(odometerKm, 0) };
  if (expectedLifeKm >= odometerKm) return { installKm: 0, kmOnComponent: odometerKm };
  let n = Math.floor(odometerKm / expectedLifeKm);
  let installKm = n * expectedLifeKm;
  let kmOn = odometerKm - installKm;
  if (kmOn === 0) {
    // Exact multiple: treat as due now rather than brand new. An estimate must
    // never claim a part is fresh.
    installKm -= expectedLifeKm;
    kmOn = expectedLifeKm;
  }
  return { installKm, kmOnComponent: kmOn };
}
