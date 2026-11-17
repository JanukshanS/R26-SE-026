// What the public site (kaduna.lk) reads, with no sign-in: garages that take
// online bookings (garage-management) and parts shops with their listed parts
// (parts-management).
const GARAGE_URL = process.env.NEXT_PUBLIC_GARAGE_URL ?? "http://localhost:3002";
const PARTS_URL = process.env.NEXT_PUBLIC_PARTS_URL ?? "http://localhost:3003";

export interface PublicGarage {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  services: string[];
  note: string | null;
  /** For the booking page: /book?g=… */
  bookingToken: string;
}

export interface PublicShop {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  openingHours: string | null;
  delivers: boolean;
  deliveryNote: string | null;
  currency: string;
  partCount: number;
  categories: string[];
}

export interface PublicPart {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  oemNumber: string | null;
  partNumber: string | null;
  unit: string;
  price: number;
  inStock: boolean;
  universal: boolean;
  fitments: { make: string; model: string; yearFrom: number | null; yearTo: number | null; note: string | null }[];
  shop: { id: string; name: string; city: string | null; address: string | null; phone: string | null; currency: string };
}

async function get<T>(base: string, path: string): Promise<T> {
  const res = await fetch(`${base}/api/v1/public${path}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.data as T;
}

const qs = (p: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export const listPublicGarages = (q?: string) => get<PublicGarage[]>(GARAGE_URL, `/garages${qs({ q })}`);
export const listPublicShops = (q?: string) => get<PublicShop[]>(PARTS_URL, `/shops${qs({ q })}`);
export const searchPublicParts = (p: { q?: string; make?: string; model?: string; year?: number; category?: string; shopId?: string; limit?: number }) =>
  get<PublicPart[]>(PARTS_URL, `/parts${qs(p)}`);
export const listPublicCategories = () => get<{ category: string; parts: number }[]>(PARTS_URL, "/categories");

/** "CA" from "City Auto Garage": for logo tiles. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "•";

/** A stable colour per name, from the mockup's palette. */
const PALETTE = ["#14a37a", "#3b82f6", "#8b5cf6", "#e8601c", "#d98a06", "#e11d48", "#0ea5e9", "#14b8a6", "#3d3852"];
export const colorFor = (name: string) => PALETTE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
