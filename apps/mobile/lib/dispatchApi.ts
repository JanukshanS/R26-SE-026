/**
 * ============================================================================
 * Dispatch API client — talks to components/dispatch (UADO) service
 * ============================================================================
 *
 * Mirrors the API of components/dispatch on port 3001. Field names match
 * the backend's TriageResponses shape exactly so we can pass through without
 * a translation layer.
 *
 * Base URL resolution:
 *   - Android emulator routes localhost differently → uses 10.0.2.2
 *   - iOS/web   → uses localhost
 *   - Override via EXPO_PUBLIC_DISPATCH_URL env var (e.g. for a deployed
 *     backend, or when running mobile on a phone over LAN)
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { Platform } from "react-native";

import { authHeaders } from "@lib/capture-api";
import type { Translate } from "@lib/i18n";

const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_DISPATCH_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:3001" : "http://localhost:3001");

export const DISPATCH_BASE_URL = DEFAULT_BASE_URL;

// ─────────────────────────────────────────────────────────────────────────
// Shared types (mirror src/types/index.ts in the backend)
// ─────────────────────────────────────────────────────────────────────────

export type ServiceType =
  // ML-diagnosable
  | "BATTERY_JUMP" | "BATTERY_TERMINAL_CLEAN" | "BATTERY_REPLACE" | "ALTERNATOR_ISSUE"
  | "STARTER_MOTOR"
  | "COOLANT_LOW" | "RADIATOR_FAN_ISSUE" | "RADIATOR_HOSE_LEAK" | "ENGINE_OVERHEAT_SEVERE"
  | "BELT_BROKEN"
  | "FUEL_FILTER_CLOGGED" | "FUEL_PUMP" | "IGNITION_SYSTEM"
  | "ELECTRICAL_FAULT_RAIN"
  | "BRAKE_PAD_WORN" | "BRAKE_FAILURE"
  | "CLUTCH_WORN" | "TRANSMISSION_ISSUE"
  | "SEVERE_MECHANICAL_TOW"
  // Fast-path
  | "LOCKOUT" | "KEY_LOST"
  | "FLAT_TIRE_CHANGE"
  | "FUEL_EMPTY" | "FUEL_WRONG"
  | "LIGHT_BULB" | "BLOWN_FUSE"
  | "MAJOR_ACCIDENT"
  | "URGENT_TOW"
  | "FLOOD_RECOVERY";

export type ProviderType =
  | "MOBILE_MECHANIC" | "FUEL_DELIVERY" | "LOCKSMITH" | "TOW_LIGHT" | "TOW_HEAVY";

export type TriageTier =
  | "QUESTIONNAIRE_ONLY" | "OBD_ENHANCED" | "BAYESIAN_LEARNED";

export const NOT_ASKED = "NOT_ASKED" as const;

export interface TriageResponses {
  Q1_intent: string;
  Q2_engine_start: string;
  Q2b_running_issue: string;
  Q3_sound: string;
  Q3b_electrical: string;
  Q4_noise_detail: string;
  Q7_overheat_detail: string;
  Q8_smoke_color: string;
  Q_brake_detail: string;
  Q_gear_detail: string;
  Q6_smells: string;
  Q5_lights: string[];
  Q9_recent: string[];
  location_type: string;
  recent_rain: string;
  parked_overnight: string;
  vehicle_age_bucket: string;
  last_fueled: string;
}

export interface TriageResult {
  probabilities: Record<string, number>;
  predictedServiceType: ServiceType;
  confidence: number;
  tier: TriageTier;
  entropy: number;
  obdDataUsed: boolean;
  bayesianPriorsApplied: boolean;
}

export interface VehicleInfo {
  make?: string;
  model?: string;
  year?: number;
  fuelType?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  registrationNumber?: string;
  hasOBD?: boolean;
}

export interface Incident {
  id: string;
  status: string;
  latitude: number;
  longitude: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  hasOBD?: boolean;
  assignedProviderId?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface DispatchedProvider {
  id: string;
  name: string;
  type: ProviderType;
  expectedCost: number;
  mismatchRisk: number;
  estimatedTravelTimeMin: number;
  costBreakdown: {
    expectedServiceCost: number;
    expectedMismatchCost: number;
    trafficExternalityCost: number;
    trustAdjustment: number;
    totalCost: number;
  };
}

export interface DispatchResultData {
  incidentId: string;
  selectedProvider: DispatchedProvider;
  allRankedProviders: Array<{
    rank: number;
    providerId: string;
    name: string;
    type: ProviderType;
    expectedCost: number;
    mismatchRisk: number;
    travelTimeMin: number;
  }>;
  metadata: {
    computationTimeMs: number;
    trafficImpactScore: number;
    trafficImpactSource?: "client" | "geo-intelligence" | "geo-unavailable" | "default";
    lambda: number;
    providersEvaluated: number;
    triageTier: string;
    triageConfidence: number;
  };
  message: string;
}

export interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  status: "AVAILABLE" | "BUSY" | "OFFLINE";
  latitude: number;
  longitude: number;
  capabilities: ServiceType[];
  /** Provider-set typical minutes-to-fix, keyed by ServiceType. Only present for services in `capabilities`. */
  serviceTimes: Record<string, number>;
  trustScore: number;
  totalJobs: number;
  successfulJobs: number;
  averageRating: number | null;
  phone: string | null;
  vehiclePlate: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Low-level request helper
// ─────────────────────────────────────────────────────────────────────────

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
  timestamp: string;
}

class DispatchApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "DispatchApiError";
    this.status = status;
    this.details = details;
  }
}

export { DispatchApiError };

/**
 * Hermes (RN's default JS engine on Android) doesn't ship `AbortSignal.timeout`,
 * so we polyfill via AbortController + setTimeout. Works identically on iOS,
 * Android, and the web bundle.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${DISPATCH_BASE_URL}${path}`;
  // Resolved before the try below so a missing session surfaces its own
  // "sign in" message instead of being reported as a transport failure.
  const auth = await authHeaders();
  const { signal, cancel } = timeoutSignal(10_000);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...auth,
        ...(init?.headers ?? {}),
      },
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "The dispatch service took too long to respond. Check your connection and try again."
      );
    }
    throw new Error(
      "Couldn't reach the dispatch service. Check your connection and try again."
    );
  } finally {
    cancel();
  }

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !body?.success) {
    throw new DispatchApiError(
      res.status,
      body?.error ?? `HTTP ${res.status}`,
      body?.details
    );
  }

  return body.data as T;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export interface CreateIncidentInput {
  location: { latitude: number; longitude: number };
  vehicleInfo?: VehicleInfo;
  description?: string;
}

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  return request<Incident>("/api/v1/incidents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SubmitTriageInput {
  incidentId: string;
  responses: TriageResponses;
  /**
   * OBD telemetry — the dispatch backend's `obdDataSchema` accepts any of
   * the documented fields plus a required `available: boolean`. We type
   * loosely here so callers can pass synthesized payloads from various
   * sources (Bluetooth ELM327, Herath's maintenance API, dev mocks).
   * See lib/elm327.ts for the standard shape (`TriageOBDData`).
   */
  obdData?: { available: boolean; [field: string]: unknown };
}

export async function submitTriage(
  input: SubmitTriageInput
): Promise<{ triageRecordId: string | null; result: TriageResult; message: string }> {
  return request("/api/v1/triage/submit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface RunDispatchInput {
  incidentId: string;
  trafficImpactScore?: number;
  maxProviders?: number;
}

export async function runDispatch(input: RunDispatchInput): Promise<DispatchResultData> {
  return request("/api/v1/dispatch/optimize", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ProviderResponseInput {
  incidentId: string;
  providerId: string;
  accepted: boolean;
  declineReason?: string;
}

/**
 * Accept or decline a job assigned to this provider. Accepting is idempotent —
 * retrying against an incident already EN_ROUTE/ON_SCENE returns the current
 * incident and writes nothing, so a network failure is safe to retry.
 */
export async function respondToJob(
  input: ProviderResponseInput
): Promise<{ incident: Incident; accepted: boolean; message: string }> {
  return request("/api/v1/dispatch/respond", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** The driver's rating lands on this row, which the provider creates on resolve. */
export interface IncidentFeedback {
  providerId: string;
  actualServiceType: string;
  wasMatch: boolean;
  resolutionTimeMinutes: number;
  /** `null` until the driver rates the job — rating is optional. */
  userRating: number | null;
  /** The driver's answer to "did they actually fix it?". `null` until asked. */
  driverConfirmed: boolean | null;
  providerNotes?: string | null;
}

export async function getIncident(
  incidentId: string
): Promise<Incident & {
  triageResponse?: any;
  assignedProvider?: ProviderRecord;
  dispatchDecisions?: any[];
  feedback?: IncidentFeedback | null;
}> {
  return request(`/api/v1/incidents/${incidentId}`);
}

/**
 * Call off a request the driver no longer needs.
 *
 * Only valid while the job is still being offered around — once a provider
 * accepts, the backend answers 409 and the driver has to speak to them
 * instead. Cancelling twice succeeds rather than erroring, so a retried tap
 * on a bad roadside connection is not punished.
 */
export async function cancelIncident(incidentId: string): Promise<Incident> {
  return request(`/api/v1/incidents/${incidentId}/cancel`, { method: "POST" });
}

/**
 * The driver's word on a job the provider has closed.
 *
 * `resolved` is the part that counts: the provider closes their own job, so
 * without this the only record of whether the car was actually fixed comes
 * from the person paid to fix it. Saying no marks the dispatch unsuccessful
 * and lowers that provider's trust, which the ECM divides expected cost by.
 *
 * The star rating is optional and moves trust only slightly, so a driver who
 * just wants to get going is not penalising anyone by skipping it.
 */
export async function confirmIncident(
  incidentId: string,
  input: { resolved: boolean; rating?: 1 | 2 | 3 | 4 | 5 }
): Promise<{ incidentId: string; driverConfirmed: boolean; rating: number | null }> {
  return request(`/api/v1/incidents/${incidentId}/confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface AssignedIncident extends Incident {
  triageResponse?: any;
  assignedProvider?: ProviderRecord | null;
}

/**
 * Jobs assigned to a provider. The backend enforces that the caller owns
 * `providerId` (403 otherwise), so this is only callable for one's own record.
 */
export async function listAssignedIncidents(
  providerId: string,
  opts?: { status?: string; limit?: number; offset?: number }
): Promise<{ incidents: AssignedIncident[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams({ assignedProviderId: providerId });
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  return request(`/api/v1/incidents?${params.toString()}`);
}

export async function getProvider(providerId: string): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}`);
}

export async function listProviders(opts?: {
  type?: ProviderType;
  status?: "AVAILABLE" | "BUSY" | "OFFLINE";
}): Promise<{ providers: ProviderRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  return request(`/api/v1/providers${qs ? `?${qs}` : ""}`);
}

export async function updateProviderStatus(
  providerId: string,
  status: "AVAILABLE" | "BUSY" | "OFFLINE"
): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export interface CreateProviderInput {
  name: string;
  type: ProviderType;
  location: { latitude: number; longitude: number };
  phone?: string;
  vehiclePlate?: string;
}

/**
 * Register a new dispatchable provider record. Capabilities are auto-derived
 * from `type` by the dispatch backend; the created record (incl. `id`) is
 * returned so the caller can link it to the auth user via `authApi.updateMe`.
 */
export async function createProvider(input: CreateProviderInput): Promise<ProviderRecord> {
  return request<ProviderRecord>("/api/v1/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProviderLocation(
  providerId: string,
  location: { latitude: number; longitude: number }
): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}/location`, {
    method: "PATCH",
    body: JSON.stringify(location),
  });
}

export interface UpdateProviderProfileInput {
  name?: string;
  phone?: string;
  vehiclePlate?: string;
  /** Must stay within PROVIDER_CAPABILITY_MATRIX[type] — the backend re-checks this. */
  capabilities?: ServiceType[];
  /** Merged into the existing map server-side, not replaced. */
  serviceTimes?: Record<string, number>;
}

export async function updateProviderProfile(
  providerId: string,
  patch: UpdateProviderProfileInput
): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface ProviderFeedback {
  id: string;
  incidentId: string;
  predictedServiceType: ServiceType;
  predictedConfidence: number;
  actualServiceType: ServiceType;
  wasMatch: boolean;
  resolutionTimeMinutes: number;
  reDispatches: number;
  userRating: number | null;
  providerNotes: string | null;
  createdAt: string;
}

export interface ProviderFeedbackSummary {
  totalJobs: number;
  matchRate: number | null;
  averageResolutionTimeMinutes: number | null;
  averageRating: number | null;
}

/** A provider's own resolution history + summary metrics. Owner-only server-side. */
export async function getProviderFeedbacks(
  providerId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{
  feedbacks: ProviderFeedback[];
  total: number;
  limit: number;
  offset: number;
  summary: ProviderFeedbackSummary;
}> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return request(`/api/v1/providers/${providerId}/feedbacks${qs ? `?${qs}` : ""}`);
}

export interface ResolveIncidentInput {
  incidentId: string;
  providerId: string;
  actualServiceType: ServiceType;
  resolutionTimeMinutes: number;
  notes?: string;
  escalationNeeded?: boolean;
}

export async function resolveIncident(input: ResolveIncidentInput) {
  return request(`/api/v1/incidents/${input.incidentId}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — used by mobile screens to display ServiceType nicely
// ─────────────────────────────────────────────────────────────────────────

/** Human-readable label for a ServiceType (driver-facing). */
export function serviceTypeLabel(st: ServiceType, t: Translate): string {
  const labels: Record<ServiceType, string> = {
    BATTERY_JUMP:           "common.serviceType.batteryJump",
    BATTERY_TERMINAL_CLEAN: "common.serviceType.batteryTerminalClean",
    BATTERY_REPLACE:        "common.serviceType.batteryReplace",
    ALTERNATOR_ISSUE:       "common.serviceType.alternatorIssue",
    STARTER_MOTOR:          "common.serviceType.starterMotor",
    COOLANT_LOW:            "common.serviceType.coolantLow",
    RADIATOR_FAN_ISSUE:     "common.serviceType.radiatorFanIssue",
    RADIATOR_HOSE_LEAK:     "common.serviceType.radiatorHoseLeak",
    ENGINE_OVERHEAT_SEVERE: "common.serviceType.engineOverheatSevere",
    BELT_BROKEN:            "common.serviceType.beltBroken",
    FUEL_FILTER_CLOGGED:    "common.serviceType.fuelFilterClogged",
    FUEL_PUMP:              "common.serviceType.fuelPump",
    IGNITION_SYSTEM:        "common.serviceType.ignitionSystem",
    ELECTRICAL_FAULT_RAIN:  "common.serviceType.electricalFaultRain",
    BRAKE_PAD_WORN:         "common.serviceType.brakePadWorn",
    BRAKE_FAILURE:          "common.serviceType.brakeFailure",
    CLUTCH_WORN:            "common.serviceType.clutchWorn",
    TRANSMISSION_ISSUE:     "common.serviceType.transmissionIssue",
    SEVERE_MECHANICAL_TOW:  "common.serviceType.severeMechanicalTow",
    LOCKOUT:                "common.serviceType.lockout",
    KEY_LOST:               "common.serviceType.keyLost",
    FLAT_TIRE_CHANGE:       "common.serviceType.flatTireChange",
    FUEL_EMPTY:             "common.serviceType.fuelEmpty",
    FUEL_WRONG:             "common.serviceType.fuelWrong",
    LIGHT_BULB:             "common.serviceType.lightBulb",
    BLOWN_FUSE:             "common.serviceType.blownFuse",
    MAJOR_ACCIDENT:         "common.serviceType.majorAccident",
    URGENT_TOW:             "common.serviceType.urgentTow",
    FLOOD_RECOVERY:         "common.serviceType.floodRecovery",
  };
  const key = labels[st];
  return key ? t(key) : st;
}

/** What the driver should expect (short version, e.g. "Jump Start needed"). */
export function serviceTypeAction(st: ServiceType, t: Translate): string {
  const actions: Partial<Record<ServiceType, string>> = {
    BATTERY_JUMP:           "common.serviceAction.batteryJump",
    BATTERY_TERMINAL_CLEAN: "common.serviceAction.batteryTerminalClean",
    BATTERY_REPLACE:        "common.serviceAction.batteryReplace",
    ALTERNATOR_ISSUE:       "common.serviceAction.alternatorIssue",
    STARTER_MOTOR:          "common.serviceAction.starterMotor",
    COOLANT_LOW:            "common.serviceAction.coolantLow",
    RADIATOR_FAN_ISSUE:     "common.serviceAction.radiatorFanIssue",
    RADIATOR_HOSE_LEAK:     "common.serviceAction.radiatorHoseLeak",
    ENGINE_OVERHEAT_SEVERE: "common.serviceAction.engineOverheatSevere",
    BELT_BROKEN:            "common.serviceAction.beltBroken",
    FUEL_FILTER_CLOGGED:    "common.serviceAction.fuelFilterClogged",
    FUEL_PUMP:              "common.serviceAction.fuelPump",
    IGNITION_SYSTEM:        "common.serviceAction.ignitionSystem",
    ELECTRICAL_FAULT_RAIN:  "common.serviceAction.electricalFaultRain",
    BRAKE_PAD_WORN:         "common.serviceAction.brakePadWorn",
    BRAKE_FAILURE:          "common.serviceAction.brakeFailure",
    CLUTCH_WORN:            "common.serviceAction.clutchWorn",
    TRANSMISSION_ISSUE:     "common.serviceAction.transmissionIssue",
    SEVERE_MECHANICAL_TOW:  "common.serviceAction.severeMechanicalTow",
    LOCKOUT:                "common.serviceAction.lockout",
    KEY_LOST:               "common.serviceAction.keyLost",
    FLAT_TIRE_CHANGE:       "common.serviceAction.flatTireChange",
    FUEL_EMPTY:             "common.serviceAction.fuelEmpty",
    FUEL_WRONG:             "common.serviceAction.fuelWrong",
    LIGHT_BULB:             "common.serviceAction.lightBulb",
    BLOWN_FUSE:             "common.serviceAction.blownFuse",
    MAJOR_ACCIDENT:         "common.serviceAction.majorAccident",
    URGENT_TOW:             "common.serviceAction.urgentTow",
    FLOOD_RECOVERY:         "common.serviceAction.floodRecovery",
  };
  return t(actions[st] ?? "common.serviceAction.fallback");
}

/** All provider types, in the order shown in the onboarding picker. */
export const PROVIDER_TYPES: ProviderType[] = [
  "MOBILE_MECHANIC",
  "FUEL_DELIVERY",
  "LOCKSMITH",
  "TOW_LIGHT",
  "TOW_HEAVY",
];

export function providerTypeLabel(pt: ProviderType, t: Translate): string {
  const labels: Record<ProviderType, string> = {
    MOBILE_MECHANIC: "common.providerType.mobileMechanic",
    FUEL_DELIVERY:   "common.providerType.fuelDelivery",
    LOCKSMITH:       "common.providerType.locksmith",
    TOW_LIGHT:       "common.providerType.towLight",
    TOW_HEAVY:       "common.providerType.towHeavy",
  };
  const key = labels[pt];
  return key ? t(key) : pt;
}

// ─────────────────────────────────────────────────────────────────────────
// Geo helper for distance display (Haversine, matches backend's optimizer)
// ─────────────────────────────────────────────────────────────────────────

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
