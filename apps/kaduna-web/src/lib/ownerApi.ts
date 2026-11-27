// The vehicle owner's side of the garage-management service (/api/v1/my):
// their cars at any garage, matched by the plates they registered, and
// booking a garage from the dashboard. Same transport as garageApi.ts.
import { GarageApiError, type AppointmentStatus, type BookingPage, type DaySlots, type JobStatus, type PublicBooking } from "./garageApi";
import { authHeaders } from "./supabase";

const BASE_URL = process.env.NEXT_PUBLIC_GARAGE_URL ?? "http://localhost:3002";

export type VisitGarage = { id: string; name: string; phone: string | null; address: string | null; logoUrl: string | null; brandColor: string | null };

export interface GarageRepair {
  id: string;
  garage: VisitGarage;
  jobNumber: number;
  status: JobStatus;
  source: "WALK_IN" | "KADUNA_DISPATCH";
  incidentId: string | null;
  plate: string | null;
  vehicle: { plate: string | null; make: string | null; model: string | null; year: number | null } | null;
  complaint: string | null;
  mechanicName: string | null;
  promisedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastUpdate: { status: JobStatus | null; note: string | null; createdAt: string } | null;
  approvalsWaiting: number;
  invoice: { status: "UNPAID" | "PAID"; total: number } | null;
  /** For /track?t=…: the full job, prices and inspection approvals. */
  trackingToken: string;
}

export interface GarageBooking {
  id: string;
  garage: VisitGarage;
  service: string;
  startsAt: string;
  durationMin: number;
  status: Extract<AppointmentStatus, "BOOKED" | "CONFIRMED">;
  plate: string | null;
  source: "STAFF" | "ONLINE";
  /** Online bookings: for /book?a=… (view or cancel). */
  manageToken: string | null;
  cancellable: boolean;
}

export interface OwnerVisits {
  repairs: GarageRepair[];
  bookings: GarageBooking[];
}

export interface DirectoryGarage {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  services: string[];
  note: string | null;
}

export type OwnerBookingInput = { startsAt: string; service: string; plate: string; vehicle?: string | null; name: string; phone: string; notes?: string | null };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/v1/my${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GarageApiError(0, "Couldn't reach the garage service. Check your connection and try again.");
  }
  let body: { success: boolean; data?: T; error?: string; details?: { path: string; message: string }[] } | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !body?.success) {
    const detail = body?.details?.[0];
    throw new GarageApiError(res.status, detail ? `${body?.error ?? "Invalid"}: ${detail.path} ${detail.message}` : body?.error ?? `HTTP ${res.status}`, body?.details);
  }
  return body.data as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listMyVisits = () => request<OwnerVisits>("/visits");
export const listBookableGarages = (search?: string) => request<DirectoryGarage[]>(`/garages${q({ q: search })}`);
export const getBookableGarage = (id: string) => request<BookingPage>(`/garages/${id}`);
export const getBookableSlots = (id: string, from?: string, days = 7) => request<DaySlots[]>(`/garages/${id}/slots${q({ from, days })}`);
export const bookGarage = (id: string, input: OwnerBookingInput) =>
  request<{ token: string; booking: PublicBooking }>(`/garages/${id}/book`, { method: "POST", body: JSON.stringify(input) });

/** Letters and digits only, so "WP-CAB-1234" and "WPCAB1234" match. */
export const compactPlate = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
