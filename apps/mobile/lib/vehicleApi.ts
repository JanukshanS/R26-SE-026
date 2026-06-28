import { Platform } from "react-native";
import { tokenStore } from "@lib/tokenStore";

const BASE_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:3002" : "http://localhost:3002");

export const VEHICLE_BASE_URL = BASE_URL;

export interface User {
  _id: string;
  name: string;
  email: string;
  role?: string;
  phone?: string;
  // Set once a provider account is linked to its dispatch provider record
  // (via PATCH /api/auth/me). Absent for drivers.
  providerId?: string | null;
  // The auth backend does not persist `location`; kept optional so existing
  // profile UI that references it stays type-safe (renders "—" when absent).
  location?: string;
}

export interface Vehicle {
  _id: string;
  userId: string;
  nickname?: string;
  make: string;
  model: string;
  year?: number;
  plateNumber: string;
  color?: string;
  currentMileage: number;
  fuelType: "petrol" | "diesel" | "hybrid" | "electric";
  isDefault: boolean;
  createdAt: string;
}

export type VehicleInput = Omit<Vehicle, "_id" | "userId" | "createdAt">;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string | null;
  details?: unknown;
  timestamp: string;
}

export class VehicleApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "VehicleApiError";
    this.status = status;
    this.details = details;
  }
}

/** Server vehicle uses `id`; the mobile app expects `_id`. */
interface ServerVehicle extends Omit<Vehicle, "_id"> {
  id: string;
}

function mapVehicle(v: ServerVehicle): Vehicle {
  const { id, ...rest } = v;
  return { _id: id, ...rest };
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const { signal, cancel } = timeoutSignal(10_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const token = tokenStore.getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal });
  } finally {
    cancel();
  }

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // non-JSON response
  }

  if (!res.ok || !body?.success) {
    throw new VehicleApiError(
      res.status,
      body?.error ?? `HTTP ${res.status}`,
      body?.details
    );
  }

  return body.data as T;
}

export async function getVehicles(): Promise<Vehicle[]> {
  const { vehicles } = await request<{ vehicles: ServerVehicle[] }>(
    "/api/v1/vehicles"
  );
  return vehicles.map(mapVehicle);
}

export async function createVehicle(data: Partial<VehicleInput>): Promise<Vehicle> {
  const { vehicle } = await request<{ vehicle: ServerVehicle }>(
    "/api/v1/vehicles",
    { method: "POST", body: JSON.stringify(data) }
  );
  return mapVehicle(vehicle);
}

export async function updateVehicle(
  id: string,
  data: Partial<VehicleInput>
): Promise<Vehicle> {
  const { vehicle } = await request<{ vehicle: ServerVehicle }>(
    `/api/v1/vehicles/${id}`,
    { method: "PUT", body: JSON.stringify(data) }
  );
  return mapVehicle(vehicle);
}

export async function deleteVehicle(id: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/api/v1/vehicles/${id}`, {
    method: "DELETE",
  });
}

export async function setDefaultVehicle(id: string): Promise<Vehicle> {
  const { vehicle } = await request<{ vehicle: ServerVehicle }>(
    `/api/v1/vehicles/${id}/set-default`,
    { method: "POST" }
  );
  return mapVehicle(vehicle);
}
