import { Platform } from "react-native";

const BASE_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3005" : "http://localhost:3005";

export interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
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
  vin?: string;
  isDefault: boolean;
  createdAt: string;
}

export type VehicleInput = Omit<Vehicle, "_id" | "userId" | "createdAt">;

interface AuthResponse {
  token: string;
  user: User;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function register(name: string, email: string, password: string, phone?: string) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password, phone }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(token: string) {
  return request<User>("/auth/me", {}, token);
}

export function updateProfile(token: string, data: { name?: string; phone?: string; location?: string }) {
  return request<User>("/auth/me", { method: "PUT", body: JSON.stringify(data) }, token);
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

export function getVehicles(token: string) {
  return request<Vehicle[]>("/vehicles", {}, token);
}

export function createVehicle(token: string, data: Partial<VehicleInput>) {
  return request<Vehicle>("/vehicles", { method: "POST", body: JSON.stringify(data) }, token);
}

export function updateVehicle(token: string, id: string, data: Partial<VehicleInput>) {
  return request<Vehicle>("/vehicles/" + id, { method: "PUT", body: JSON.stringify(data) }, token);
}

export function deleteVehicle(token: string, id: string) {
  return request<{ message: string }>("/vehicles/" + id, { method: "DELETE" }, token);
}

export function setDefaultVehicle(token: string, id: string) {
  return request<Vehicle>("/vehicles/" + id + "/set-default", { method: "POST" }, token);
}
