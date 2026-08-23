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
