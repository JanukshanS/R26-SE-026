/**
 * Garages and spare parts for drivers.
 *
 * One source each, shared with kaduna.lk:
 *   garages → garage-management's public directory (garages that registered
 *             on Kaduna and chose to be listed);
 *   parts   → parts-management's public catalogue (parts that shops list).
 *
 * Calling a garage goes through `callGarage`, which logs the call with
 * garage-management first (the admin dashboard counts these) and then opens
 * the phone dialler.
 */
import { Linking } from "react-native";

import { authHeaders } from "./capture-api";

const GARAGE_URL = (process.env.EXPO_PUBLIC_GARAGE_URL ?? "https://garage.vps.kaduna.lk").replace(/\/$/, "");
const PARTS_URL = (process.env.EXPO_PUBLIC_PARTS_URL ?? "https://parts.vps.kaduna.lk").replace(/\/$/, "");
const TIMEOUT_MS = 10_000;

export interface DirectoryGarage {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  services: string[];
  note: string | null;
  bookingToken: string;
}

export interface PartFitment {
  make: string;
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface CataloguePart {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  oemNumber: string | null;
  partNumber: string | null;
  unit: string | null;
  price: number;
  inStock: boolean;
  universal: boolean;
  fitments: PartFitment[];
  shop: { id: string; name: string; city: string | null; address: string | null; phone: string | null; currency: string };
}

/** fetch with a timeout. Hermes (Android) has no AbortSignal.timeout, so abort by hand. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url);
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.data as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `?${q}` : "";
};

export function listGarages(search?: string): Promise<DirectoryGarage[]> {
  return getJson<DirectoryGarage[]>(`${GARAGE_URL}/api/v1/public/garages${query({ q: search })}`);
}

export function listParts(opts: { search?: string; category?: string; make?: string; model?: string; year?: number } = {}): Promise<CataloguePart[]> {
  return getJson<CataloguePart[]>(
    `${PARTS_URL}/api/v1/public/parts${query({ q: opts.search, category: opts.category, make: opts.make, model: opts.model, year: opts.year, limit: 60 })}`
  );
}

export function listPartCategories(): Promise<{ category: string; parts: number }[]> {
  return getJson(`${PARTS_URL}/api/v1/public/categories`);
}

/** Sri Lankan numbers as typed by garages ("077 123 4567", "+94 11 …") → something every dialler accepts. */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Log the call, then open the dialler.
 *
 * Logging is best-effort: someone who needs a garage must never be stopped
 * from calling because the network or the log is down. In that case we dial
 * the listed number anyway and the call simply isn't counted.
 */
export async function callGarage(garage: Pick<DirectoryGarage, "id" | "phone">): Promise<{ logged: boolean }> {
  let phone = garage.phone;
  let logged = false;
  try {
    const res = await fetchWithTimeout(
      `${GARAGE_URL}/api/v1/garage-calls`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ garageId: garage.id, source: "app" }),
      },
      5_000
    );
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { phone?: string } } | null;
    if (res.ok && body?.success) {
      logged = true;
      // The number the log recorded is the one to dial.
      phone = body.data?.phone ?? phone;
    }
  } catch {
    // Offline, signed out, service down: dial anyway.
  }
  if (!phone) throw new Error("This garage has no phone number listed");
  await Linking.openURL(`tel:${dialable(phone)}`);
  return { logged };
}

/** Parts shops aren't audited (the MVP counts garage calls); this just opens the dialler. */
export async function callShop(phone: string): Promise<void> {
  await Linking.openURL(`tel:${dialable(phone)}`);
}

/** "LKR 4,500" — shops price in their own currency, almost always LKR. */
export function formatPrice(amount: number, currency = "LKR"): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}
