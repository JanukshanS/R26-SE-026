// Dispatch service client for the provider console. Ported from
// apps/mobile/lib/dispatchApi.ts — same paths, same request bodies, same
// `{ success, data }` envelope — trimmed to what /provider actually calls.
import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_DISPATCH_URL ?? "http://localhost:3001";

export type ProviderType =
  | "MOBILE_MECHANIC"
  | "FUEL_DELIVERY"
  | "LOCKSMITH"
  | "TOW_LIGHT"
  | "TOW_HEAVY";

export type ProviderStatus = "AVAILABLE" | "BUSY" | "OFFLINE";

/** ServiceType is a closed enum backend-side; the console only echoes values back. */
export type ServiceType = string;

export interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  status: ProviderStatus;
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

export interface Incident {
  id: string;
  status: string;
  latitude: number;
  longitude: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  registrationNo?: string | null;
  description?: string | null;
  assignedProviderId?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface AssignedIncident extends Incident {
  triageResponse?: {
    predictedServiceType?: ServiceType;
    confidence?: number;
    tier?: string;
  } | null;
  assignedProvider?: ProviderRecord | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export class DispatchApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DispatchApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      "Couldn't reach the dispatch service. Check your connection and try again."
    );
  }

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !body?.success) {
    throw new DispatchApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

export async function getProvider(providerId: string): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}`);
}

// ─── Reporting a breakdown (/report) ─────────────────────────────────────

export interface VehicleInfo {
  make?: string;
  model?: string;
  year?: number;
  fuelType?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  /** Copied to the incident's `registrationNo` — the only link back to a
   *  driver, so listMyIncidents on /app matches on it. */
  registrationNumber?: string;
  hasOBD?: boolean;
}

export async function createIncident(input: {
  location: { latitude: number; longitude: number };
  vehicleInfo?: VehicleInfo;
  description?: string;
}): Promise<Incident> {
  return request<Incident>("/api/v1/incidents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TriageResult {
  probabilities: Record<string, number>;
  predictedServiceType: ServiceType;
  confidence: number;
  tier: "QUESTIONNAIRE_ONLY" | "OBD_ENHANCED" | "BAYESIAN_LEARNED";
  entropy: number;
  obdDataUsed: boolean;
  bayesianPriorsApplied: boolean;
}

/** `obdData` is omitted entirely: the browser has no ELM327 bridge, and the
 *  backend's submitTriageSchema marks the field optional (Tier-1 diagnosis). */
export async function submitTriage(input: {
  incidentId: string;
  responses: Record<string, unknown>;
}): Promise<{ triageRecordId: string | null; result: TriageResult; message: string }> {
  return request("/api/v1/triage/submit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface DispatchResultData {
  incidentId: string;
  selectedProvider: {
    id: string;
    name: string;
    type: ProviderType;
    expectedCost: number;
    mismatchRisk: number;
    estimatedTravelTimeMin: number;
  };
  allRankedProviders: Array<{
    rank: number;
    providerId: string;
    name: string;
    type: ProviderType;
    travelTimeMin: number;
  }>;
  metadata: {
    computationTimeMs: number;
    trafficImpactScore: number;
    providersEvaluated: number;
    triageTier: string;
    triageConfidence: number;
  };
  message: string;
}

/** `trafficImpactScore` is deliberately omitted — dispatch sources it live
 *  from geo-intelligence, exactly as the mobile screens leave it. */
export async function runDispatch(input: {
  incidentId: string;
  maxProviders?: number;
}): Promise<DispatchResultData> {
  return request("/api/v1/dispatch/optimize", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function providerTypeLabel(pt: ProviderType): string {
  const labels: Record<ProviderType, string> = {
    MOBILE_MECHANIC: "Mobile Mechanic",
    FUEL_DELIVERY: "Fuel Delivery",
    LOCKSMITH: "Locksmith",
    TOW_LIGHT: "Tow Truck (Light)",
    TOW_HEAVY: "Tow Truck (Heavy)",
  };
  return labels[pt] ?? pt;
}

/** Every registered provider. Signed-in-only backend-side, no ownership check. */
export async function listProviders(
  limit = 100
): Promise<{ providers: ProviderRecord[]; total: number }> {
  return request(`/api/v1/providers?limit=${limit}`);
}

export async function updateProviderStatus(
  providerId: string,
  status: ProviderStatus
): Promise<ProviderRecord> {
  return request(`/api/v1/providers/${providerId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
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

/**
 * Jobs assigned to a provider. The backend enforces that the caller owns
 * `providerId` (403 otherwise), so this only ever returns one's own jobs.
 * The rows include `triageResponse` and `assignedProvider`.
 */
export async function listAssignedIncidents(
  providerId: string,
  opts?: { status?: string; limit?: number; offset?: number }
): Promise<{
  incidents: AssignedIncident[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams({ assignedProviderId: providerId });
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  return request(`/api/v1/incidents?${params.toString()}`);
}

/** Incident statuses that will never change again — polling stops on these. */
export const TERMINAL_INCIDENT_STATUSES = ["RESOLVED", "ESCALATED", "CANCELLED"];

/** Plates are typed by hand in several places; compare them shape-insensitively. */
function plateKey(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The signed-in driver's own incidents, newest first.
 *
 * The dispatch Incident model has NO user or driver column — the only link back
 * to a person is `registrationNo`, which incident creation copies from the
 * reporting vehicle. So this reads the (unscoped, signed-in-only) listing and
 * keeps the rows whose registration matches one of the caller's own plates.
 * `limit` is deliberately generous: the filter runs client-side, so a small page
 * would hide the driver's incidents behind other people's newer ones.
 */
export async function listMyIncidents(
  plates: string[],
  limit = 100
): Promise<AssignedIncident[]> {
  if (plates.length === 0) return [];
  const mine = new Set(plates.map(plateKey));
  const page = await request<{ incidents: AssignedIncident[] }>(
    `/api/v1/incidents?limit=${limit}`
  );
  return page.incidents.filter((i) => i.registrationNo && mine.has(plateKey(i.registrationNo)));
}

/** Accepting is idempotent backend-side, so a failed accept is safe to retry. */
export async function respondToJob(input: {
  incidentId: string;
  providerId: string;
  accepted: boolean;
  declineReason?: string;
}): Promise<{ incident: Incident; accepted: boolean; message: string }> {
  return request("/api/v1/dispatch/respond", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resolveIncident(input: {
  incidentId: string;
  providerId: string;
  actualServiceType: ServiceType;
  resolutionTimeMinutes: number;
  notes?: string;
  escalationNeeded?: boolean;
}) {
  return request(`/api/v1/incidents/${input.incidentId}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Haversine distance in km, matching the backend optimizer. */
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

// ponytail: derived from the enum instead of mobile's hand-written 30-entry
// label map. Swap in the map if the wording ever needs to match mobile exactly.
export function enumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
