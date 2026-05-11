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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${DISPATCH_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });

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

export async function getIncident(
  incidentId: string
): Promise<Incident & {
  triageResponse?: any;
  assignedProvider?: ProviderRecord;
  dispatchDecisions?: any[];
}> {
  return request(`/api/v1/incidents/${incidentId}`);
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
export function serviceTypeLabel(st: ServiceType): string {
  const labels: Record<ServiceType, string> = {
    BATTERY_JUMP:           "Battery Dead — Jump Start",
    BATTERY_TERMINAL_CLEAN: "Battery Terminal Cleaning",
    BATTERY_REPLACE:        "Battery Replacement",
    ALTERNATOR_ISSUE:       "Alternator Issue",
    STARTER_MOTOR:          "Starter Motor Failure",
    COOLANT_LOW:            "Low Coolant — Top-up",
    RADIATOR_FAN_ISSUE:     "Radiator Fan Issue",
    RADIATOR_HOSE_LEAK:     "Radiator Hose Leak",
    ENGINE_OVERHEAT_SEVERE: "Severe Engine Overheating",
    BELT_BROKEN:            "Broken Drive Belt",
    FUEL_FILTER_CLOGGED:    "Clogged Fuel Filter",
    FUEL_PUMP:              "Fuel Pump Failure",
    IGNITION_SYSTEM:        "Ignition System Issue",
    ELECTRICAL_FAULT_RAIN:  "Rain-Related Electrical Fault",
    BRAKE_PAD_WORN:         "Worn Brake Pads",
    BRAKE_FAILURE:          "Brake Failure",
    CLUTCH_WORN:            "Worn Clutch",
    TRANSMISSION_ISSUE:     "Transmission Issue",
    SEVERE_MECHANICAL_TOW:  "Severe Mechanical — Tow Needed",
    LOCKOUT:                "Locked Out",
    KEY_LOST:               "Lost Keys",
    FLAT_TIRE_CHANGE:       "Flat Tire — Change Needed",
    FUEL_EMPTY:             "Out of Fuel",
    FUEL_WRONG:             "Wrong Fuel Filled",
    LIGHT_BULB:             "Light Bulb Replacement",
    BLOWN_FUSE:             "Blown Fuse",
    MAJOR_ACCIDENT:         "Major Accident — Tow",
    URGENT_TOW:             "Urgent Tow",
    FLOOD_RECOVERY:         "Flood / Mud Recovery",
  };
  return labels[st] ?? st;
}

/** What the driver should expect (short version, e.g. "Jump Start needed"). */
export function serviceTypeAction(st: ServiceType): string {
  const actions: Partial<Record<ServiceType, string>> = {
    BATTERY_JUMP:           "Jump Start needed",
    BATTERY_TERMINAL_CLEAN: "Terminal cleaning",
    BATTERY_REPLACE:        "Battery replacement",
    ALTERNATOR_ISSUE:       "Alternator service",
    STARTER_MOTOR:          "Starter repair",
    COOLANT_LOW:            "Top-up coolant",
    RADIATOR_FAN_ISSUE:     "Radiator service",
    RADIATOR_HOSE_LEAK:     "Hose repair",
    ENGINE_OVERHEAT_SEVERE: "Tow to workshop",
    BELT_BROKEN:            "Belt replacement",
    FUEL_FILTER_CLOGGED:    "Filter replacement",
    FUEL_PUMP:              "Fuel pump service",
    IGNITION_SYSTEM:        "Ignition repair",
    ELECTRICAL_FAULT_RAIN:  "Electrical diagnosis",
    BRAKE_PAD_WORN:         "Brake pad replacement",
    BRAKE_FAILURE:          "Tow to workshop",
    CLUTCH_WORN:            "Tow to workshop",
    TRANSMISSION_ISSUE:     "Tow to workshop",
    SEVERE_MECHANICAL_TOW:  "Heavy tow",
    LOCKOUT:                "Locksmith dispatch",
    KEY_LOST:               "Locksmith dispatch",
    FLAT_TIRE_CHANGE:       "Tire change",
    FUEL_EMPTY:             "Fuel delivery",
    FUEL_WRONG:             "Fuel correction",
    LIGHT_BULB:             "Bulb replacement",
    BLOWN_FUSE:             "Fuse replacement",
    MAJOR_ACCIDENT:         "Recovery + tow",
    URGENT_TOW:             "Urgent tow",
    FLOOD_RECOVERY:         "Vehicle recovery",
  };
  return actions[st] ?? "Service dispatch";
}

export function providerTypeLabel(pt: ProviderType): string {
  const labels: Record<ProviderType, string> = {
    MOBILE_MECHANIC: "Mobile Mechanic",
    FUEL_DELIVERY:   "Fuel Delivery",
    LOCKSMITH:       "Locksmith",
    TOW_LIGHT:       "Tow Truck (Light)",
    TOW_HEAVY:       "Tow Truck (Heavy)",
  };
  return labels[pt] ?? pt;
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
