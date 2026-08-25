import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_MAINTENANCE_URL ?? "http://localhost:5000";

export type ComponentKey = "engine" | "brake" | "tire" | "battery";

export interface PartRecord {
  id: string;
  component: ComponentKey;
  name: string;
  brand: string | null;
  part_number: string | null;
  category: string | null;
  price_lkr: number;
  grade: string | null;
  supplier: string | null;
  supplier_url: string | null;
  fits_note: string | null;
  vehicle_compatibility?: string[];
  fits_models: string | null;
  fits_any_model: boolean;
  stock_count: number | null;
  in_stock: boolean;
  rating: number | null;
  review_count: number | null;
  warranty: string | null;
}

export interface GarageRecord {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  services: string[];
  services_raw: string | null;
  speciality: string | null;
  mechanics: number | null;
  rating: number | null;
  review_count: number | null;
  labour_lkr: number | null;
  opening_hours: string | null;
  verified: boolean;
  coords_are_city_level: boolean;
}

export type PartInput = {
  name: string;
  component: ComponentKey;
  price_lkr: number;
  brand?: string;
  part_number?: string;
  category?: string;
  grade?: string;
  supplier?: string;
  supplier_url?: string;
  vehicle_compatibility?: string[];
  fits_any_model?: boolean;
  stock_count?: number;
  in_stock?: boolean;
  rating?: number;
  review_count?: number;
  warranty?: string;
};

export type GarageInput = {
  name: string;
  address?: string;
  city?: string;
  area?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  services?: string[];
  speciality?: string[];
  mechanics?: number;
  rating?: number;
  review_count?: number;
  labour_lkr?: number;
  opening_hours?: string;
  verified?: boolean;
  coords_are_city_level?: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listParts(component?: ComponentKey): Promise<PartRecord[]> {
  const q = component ? `?component=${encodeURIComponent(component)}` : "";
  return request<PartRecord[]>(`/admin/parts${q}`);
}

export function createPart(payload: PartInput): Promise<PartRecord> {
  return request<PartRecord>("/admin/parts", { method: "POST", body: JSON.stringify(payload) });
}

export function updatePart(id: string, payload: Partial<PartInput>): Promise<PartRecord> {
  return request<PartRecord>(`/admin/parts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePart(id: string): Promise<void> {
  return request<void>(`/admin/parts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listGarages(city?: string): Promise<GarageRecord[]> {
  const q = city ? `?city=${encodeURIComponent(city)}` : "";
  return request<GarageRecord[]>(`/admin/garages${q}`);
}

export function createGarage(payload: GarageInput): Promise<GarageRecord> {
  return request<GarageRecord>("/admin/garages", { method: "POST", body: JSON.stringify(payload) });
}

export function updateGarage(id: string, payload: Partial<GarageInput>): Promise<GarageRecord> {
  return request<GarageRecord>(`/admin/garages/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteGarage(id: string): Promise<void> {
  return request<void>(`/admin/garages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function formatLkr(amount: number): string {
  return `LKR ${Math.round(amount).toLocaleString("en-LK")}`;
}
