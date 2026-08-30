import { Platform } from "react-native";

import { authHeaders } from "@lib/capture-api";
import { type Translate } from "@lib/i18n";
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
  /**
   * Live trouble codes filed against this component.
   *
   * Deliberately separate from health_pct: a misfire does not consume brake
   * pad life, so a fault never moves a wear number. It can raise urgency,
   * which the server does server-side.
   */
  faults?: VehicleFault[];
}

export interface VehicleHealthResponse {
  vehicle_id: string;
  overall_health_pct: number;
  overall_status: ComponentStatus;
  trip_count: number;
  total_mileage_km: number;
  components: Record<ComponentKey, ComponentHealth>;
  /** Every live fault, including "other" ones that belong to no component. */
  faults?: VehicleFault[];
  /** False when no trip has yet completed a code read - "not checked yet". */
  faults_checked?: boolean;
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
      // Passed through as-is rather than reshaped: this function whitelists
      // fields, which is exactly why faults went missing the first time - the
      // backend sent them, but normalizeHealth only ever forwarded what was
      // written into it explicitly and this array was added later.
      faults: Array.isArray(c?.faults) ? c.faults : [],
    };
  }
  return {
    vehicle_id: typeof raw?.vehicle_id === "string" ? raw.vehicle_id : vehicleId,
    overall_health_pct: Number(raw?.overall_health_pct) || 0,
    overall_status: normalizeStatus(raw?.overall_status),
    trip_count: Number(raw?.trip_count) || 0,
    total_mileage_km: Number(raw?.total_mileage_km) || 0,
    components,
    faults: Array.isArray(raw?.faults) ? raw.faults : [],
    faults_checked: Boolean(raw?.faults_checked),
  };
}

export async function getVehicleHealth(vehicleId: string): Promise<VehicleHealthResponse> {
  // Confirmed on a real device against the hosted backend: this genuinely
  // takes longer than 5s and was aborting client-side before the server ever
  // finished. Unlike most calls in this file, /health is not a lookup - it
  // runs ML inference across four components plus a distance-weighted trip
  // aggregation, so it belongs with submitTrip's budget, not the simple
  // metadata calls it used to share a timeout with.
  const { signal, cancel } = timeoutSignal(15000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/health`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) {
      // Swallowing this into a generic "couldn't load" left every real cause -
      // a timeout, an auth failure, a 500 - looking identical on screen and in
      // the logs, which is what turned "which of five things broke" into a
      // guessing game the first time this ran against a real host instead of
      // localhost.
      const body = await res.text().catch(() => "");
      console.log(`[maintenanceApi] health ${res.status} for ${vehicleId}: ${body.slice(0, 300)}`);
      throw new Error(`HTTP ${res.status}`);
    }
    return normalizeHealth(await res.json(), vehicleId);
  } catch (err) {
    // The other half of the gap above: `fetch` itself can throw before any
    // response exists at all - the 5s AbortController firing, a TLS failure,
    // no route to host. Rethrown unchanged so callers see the same error;
    // logged first because that path previously left nothing to look at.
    console.log(`[maintenanceApi] health request failed for ${vehicleId}:`, err);
    throw err;
  } finally {
    cancel();
  }
}

/** Convert RUL km → human label, e.g. "4 weeks", "Healthy", "No data" */
/** The five statuses the maintenance service reports, in the driver's language. */
export function componentStatusLabel(status: ComponentStatus, t: Translate): string {
  const keys: Record<ComponentStatus, string> = {
    Good: "driver.health.statusGood",
    Fair: "driver.health.statusFair",
    Poor: "driver.health.statusPoor",
    Critical: "driver.health.statusCritical",
    "No data": "driver.health.statusNoData",
  };
  return t(keys[status]);
}

export function rulToLabel(component: ComponentHealth, t: Translate): string {
  if (component.status === "No data") return t("driver.health.rulNoData");
  if (component.status === "Good") return t("driver.health.rulHealthy");
  const rul = component.predicted_rul_km;
  if (rul < 500) return t("driver.health.rulUrgent");
  if (rul < 2000) return t("driver.health.rulOneWeek");
  if (rul < 4000) return t("driver.health.rulFourWeeks");
  if (rul < 10000) return t("driver.health.rulThousandKm", { value: Math.round(rul / 1000) });
  return t("driver.health.rulHealthy");
}

/** Urgency banner copy, e.g. "Action recommend in 4 weeks" */
export function rulToBanner(component: ComponentHealth, t: Translate): string {
  if (component.status === "No data") return t("driver.health.bannerNoData");
  if (component.status === "Good") return t("driver.health.bannerNoAction");
  const rul = component.predicted_rul_km;
  if (rul < 500) return t("driver.health.bannerImmediate");
  if (rul < 2000) return t("driver.health.bannerOneWeek");
  if (rul < 4000) return t("driver.health.bannerFourWeeks");
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

/**
 * A live trouble code as the driver sees it.
 *
 * `leads_to` and `cost_multiplier` are the predictive half: what this fault
 * damages if left alone. They come from a curated server-side table, never
 * from the language model, because they are the claim a driver spends money
 * on.
 */
export interface VehicleFault {
  code: string;
  title: string;
  component: "engine" | "brake" | "tire" | "battery" | "other";
  severity: "urgent" | "soon" | "monitor";
  status: "confirmed" | "pending" | "permanent";
  likely_causes: string[];
  leads_to: string[];
  cost_multiplier: number | null;
  first_seen_at: string;
  last_seen_at: string;
  times_seen: number;
  /** Above zero means it was cleared and came back - usually reset, not fixed. */
  recurrences: number;
  /** True when matched by code family, so the UI must hedge rather than assert. */
  is_generic: boolean;
  freeze_frame: Record<string, number> | null;
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
  /** Fault codes read from modes 03 and 07 as the trip ended. */
  dtcs?: { code: string; status: "confirmed" | "pending" | "permanent" }[];
  /**
   * Whether the code read itself succeeded, which is NOT the same question as
   * whether any codes came back. An adapter that did not answer produces the
   * same empty list as a car with nothing wrong, and the server will not close
   * a live fault unless this is true.
   */
  dtc_read_ok?: boolean;
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

// ── Marketplace (parts store) ─────────────────────────────────────────────

export interface MarketplacePart {
  id: string;
  component: ComponentKey;
  name: string;
  brand: string | null;
  fits_note: string | null;
  price_lkr: number;
  grade: string | null;
  supplier: string | null;
  in_stock: boolean;
  rating: number | null;
}

export interface MarketplaceGarage {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  services: string[];
  rating: number | null;
  labour_lkr: number | null;
  opening_hours: string | null;
  verified: boolean;
  distance_km: number | null;
}

/**
 * What drivers actually paid, aggregated from their own logged service
 * records. Distinct from a catalogue price: a listing is a quote, this is
 * evidence. `is_reliable` is false when too few services have been logged to
 * say anything - the range must not be rendered in that case, because one
 * driver's invoice is an anecdote and would read as a benchmark.
 */
export interface ObservedPrices {
  component: string;
  sample_size: number;
  low_lkr: number | null;
  median_lkr: number | null;
  high_lkr: number | null;
  is_reliable: boolean;
  note: string;
}

export interface ComponentMarketplace {
  component: string;
  parts: MarketplacePart[];
  garages: MarketplaceGarage[];
  estimated_total_lkr: number | null;
  observed_prices: ObservedPrices | null;
}

export function formatLkr(amount: number): string {
  return `LKR ${Math.round(amount).toLocaleString("en-LK")}`;
}

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
  /** Ready-to-render prose. Populated whether or not the LLM was reachable. */
  text: string;
  /** "llm" when a model wrote it, "fallback" for the deterministic wording. */
  source: "llm" | "fallback";
}

/**
 * What the driver should do about one component.
 *
 * The DECISION is made server-side, deliberately: the urgency thresholds, the
 * oil-interval override and the estimate disclosure all live there so a phone
 * running a stale bundle can never disagree with the server about whether a
 * brake pad is dangerous.
 */
export async function getComponentAdvice(
  vehicleId: string,
  component: ComponentKey
): Promise<ComponentAdvice | null> {
  const { signal, cancel } = timeoutSignal(15_000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/advice/${encodeURIComponent(component)}`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object" || !raw.advice) return null;
    return raw as ComponentAdvice;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

export interface PlanRecommendation {
  garage_id: string | null;
  garage_name: string | null;
  part_id: string | null;
  part_name: string | null;
  /** One sentence: why this garage beat the others. Rendered as a subtitle. */
  garage_reason: string;
  /** Two or three sentences on what the mechanic will physically do. */
  how_its_done: string;
  /**
   * Knowledge base passages the repair description was written from, as
   * "Document title - Section". Empty when retrieval was unavailable, in
   * which case the text is the model's own general knowledge.
   */
  sources: string[];
  estimated_total_lkr: number | null;
}

export interface ComponentPlan {
  advice: ComponentAdvice["advice"];
  text: string;
  source: "llm" | "fallback";
  parts: MarketplacePart[];
  garages: MarketplaceGarage[];
  observed_prices: ObservedPrices | null;
  /** Absent when the model was unreachable, or named something that does not exist. */
  recommendation: PlanRecommendation | null;
}

/**
 * Diagnosis, the real options, and a recommendation among them.
 *
 * Supersedes getComponentAdvice on the component screen: one round trip
 * instead of two, and the model can only compare options the driver is also
 * shown. Location is optional - without it garages are ranked by rating
 * rather than distance, and the model is told the location is unknown so it
 * cannot argue from a proximity it does not have.
 */
export async function getComponentPlan(
  vehicleId: string,
  component: ComponentKey,
  opts: { lat?: number; lon?: number; vehicle?: string } = {}
): Promise<ComponentPlan | null> {
  const params = new URLSearchParams();
  if (opts.lat != null && opts.lon != null) {
    params.set("lat", String(opts.lat));
    params.set("lon", String(opts.lon));
  }
  if (opts.vehicle) params.set("vehicle", opts.vehicle);

  // Generous: this may make a language-model call. The screen renders health
  // without it, so a slow reply costs nothing but the card.
  const { signal, cancel } = timeoutSignal(30_000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/plan/${encodeURIComponent(component)}?${params}`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object" || !raw.advice) return null;
    return raw as ComponentPlan;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/**
 * Everything about one fault: what it is, where to fix it, and what happens.
 *
 * Mirrors ComponentPlan, but keyed on a code rather than a component - which
 * is what lets a transmission or fuel-cap fault have a page at all, since
 * those map to none of the four components and have no wear reading.
 */
export interface FaultPlan {
  fault: VehicleFault;
  /** Wear context, present only when the fault maps to a modelled component. */
  component_health: (ComponentHealth & { component?: string }) | null;
  parts: MarketplacePart[];
  garages: MarketplaceGarage[];
  observed_prices: ObservedPrices | null;
  recommendation: PlanRecommendation | null;
  source: "llm" | "fallback";
}

/**
 * Diagnosis, options and a recommendation for one fault code.
 *
 * Same 30s budget as getComponentPlan: it may make a language-model call, and
 * the screen renders the fault itself without it.
 */
export async function getFaultPlan(
  vehicleId: string,
  code: string,
  opts: { lat?: number; lon?: number; vehicle?: string } = {}
): Promise<FaultPlan | null> {
  const params = new URLSearchParams();
  if (opts.lat != null && opts.lon != null) {
    params.set("lat", String(opts.lat));
    params.set("lon", String(opts.lon));
  }
  if (opts.vehicle) params.set("vehicle", opts.vehicle);

  const { signal, cancel } = timeoutSignal(30_000);
  try {
    const res = await fetch(
      `${BASE_URL}/vehicle/${encodeURIComponent(vehicleId)}/fault/${encodeURIComponent(code)}/plan?${params}`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object" || !raw.fault) return null;
    return raw as FaultPlan;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

export interface MarketplaceBrowse {
  parts: MarketplacePart[];
  garages: MarketplaceGarage[];
  /** Component keys actually present in `parts`, for building filter chips. */
  components: string[];
  /** Set when the parts list was narrowed to one vehicle; null when unfiltered. */
  filtered_to_vehicle: string | null;
}

/**
 * The whole store. Separate from getComponentMarketplace, which answers "this
 * part is worn, what now?" and carries advice and a price benchmark that only
 * mean something for a specific component.
 */
export async function browseMarketplace(opts: {
  component?: string;
  vehicle?: string;
  search?: string;
} = {}): Promise<MarketplaceBrowse | null> {
  const params = new URLSearchParams({ limit_parts: "60", limit_garages: "40" });
  if (opts.component) params.set("component", opts.component);
  if (opts.vehicle) params.set("vehicle", opts.vehicle);
  if (opts.search) params.set("search", opts.search);

  const { signal, cancel } = timeoutSignal(10_000);
  try {
    const res = await fetch(`${BASE_URL}/marketplace?${params}`, {
      headers: await authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") return null;
    return {
      parts: Array.isArray(raw.parts) ? raw.parts : [],
      garages: Array.isArray(raw.garages) ? raw.garages : [],
      components: Array.isArray(raw.components) ? raw.components : [],
      filtered_to_vehicle:
        typeof raw.filtered_to_vehicle === "string" ? raw.filtered_to_vehicle : null,
    };
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/** Parts and garages for one component category in the store. */
export async function getComponentMarketplace(
  component: ComponentKey,
  vehicle?: string
): Promise<ComponentMarketplace | null> {
  const params = new URLSearchParams({ limit_parts: "20", limit_garages: "10" });
  if (vehicle) params.set("vehicle", vehicle);

  const { signal, cancel } = timeoutSignal(10_000);
  try {
    const res = await fetch(
      `${BASE_URL}/marketplace/${encodeURIComponent(component)}?${params}`,
      { headers: await authHeaders(), signal }
    );
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") return null;
    return {
      component: String(raw.component ?? component),
      parts: Array.isArray(raw.parts) ? raw.parts : [],
      garages: Array.isArray(raw.garages) ? raw.garages : [],
      estimated_total_lkr:
        typeof raw.estimated_total_lkr === "number" ? raw.estimated_total_lkr : null,
      // The server computes this from service_records.cost_lkr. It was being
      // dropped here, so the one figure grounded in what people were actually
      // charged never reached the screen.
      observed_prices:
        raw.observed_prices && typeof raw.observed_prices === "object"
          ? {
              component: String(raw.observed_prices.component ?? component),
              sample_size: Number(raw.observed_prices.sample_size ?? 0),
              low_lkr:
                typeof raw.observed_prices.low_lkr === "number" ? raw.observed_prices.low_lkr : null,
              median_lkr:
                typeof raw.observed_prices.median_lkr === "number" ? raw.observed_prices.median_lkr : null,
              high_lkr:
                typeof raw.observed_prices.high_lkr === "number" ? raw.observed_prices.high_lkr : null,
              is_reliable: Boolean(raw.observed_prices.is_reliable),
              note: String(raw.observed_prices.note ?? ""),
            }
          : null,
    };
  } catch {
    return null;
  } finally {
    cancel();
  }
}
