/**
 * The garage-management service, from this side.
 *
 *   me(token)        who the caller is to a garage (OWNER or MECHANIC), asked
 *                    with the caller's own token, so a garage can only be
 *                    acted for by its own people.
 *   staff / job      a garage's mechanics (with their Kaduna account) and a
 *                    job card, through the garage service's internal API.
 *   note / addParts  write back to the job: a timeline note, and the parts
 *                    once they're handed over.
 *
 * The internal API is server to server, with a shared secret
 * (INTERNAL_API_TOKEN), on the private network only.
 */
import { config } from '../config';
import { DomainError } from '../utils/http';

export interface GarageMe {
  role: 'OWNER' | 'MECHANIC' | null;
  garage: { id: string; name: string; phone: string | null; address: string | null } | null;
  staff: { id: string; name: string } | null;
}

export interface GarageStaff {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  userId: string | null;
}

export interface GarageJob {
  id: string;
  number: number;
  status: string;
  /** Can still take lines: not finished and not invoiced. */
  editable: boolean;
  vehicle: { plate: string | null; make: string | null; model: string | null; year: number | null } | null;
}

export interface PartLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface GarageClient {
  me(token: string): Promise<GarageMe>;
  staff(garageId: string): Promise<GarageStaff[]>;
  job(garageId: string, jobId: string): Promise<GarageJob | null>;
  note(garageId: string, jobId: string, note: string): Promise<void>;
  addParts(garageId: string, jobId: string, lines: PartLine[], note: string): Promise<{ added: boolean }>;
}

const unreachable = () => new DomainError(502, "Couldn't reach the garage service. Try again in a moment");

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  else headers['X-Internal-Token'] = config.internalToken;
  let res: Response;
  try {
    res = await fetch(`${config.garageUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(5000) });
  } catch {
    throw unreachable();
  }
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (res.status === 404) throw new DomainError(404, body?.error ?? 'Not found in the garage');
  if (res.status === 401 || res.status === 403) throw new DomainError(res.status, body?.error ?? 'Not allowed by the garage service');
  if (!res.ok || !body?.success) throw unreachable();
  return body.data as T;
}

const httpClient: GarageClient = {
  me: (token) => call<GarageMe>('/api/v1/me', { token }),
  staff: (garageId) => call<GarageStaff[]>(`/internal/v1/garages/${encodeURIComponent(garageId)}/staff`),
  job: async (garageId, jobId) => {
    try {
      return await call<GarageJob>(`/internal/v1/garages/${encodeURIComponent(garageId)}/job-cards/${encodeURIComponent(jobId)}`);
    } catch (err) {
      if (err instanceof DomainError && err.status === 404) return null;
      throw err;
    }
  },
  note: async (garageId, jobId, note) => {
    await call(`/internal/v1/garages/${encodeURIComponent(garageId)}/job-cards/${encodeURIComponent(jobId)}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
  },
  addParts: (garageId, jobId, lines, note) =>
    call<{ added: boolean }>(`/internal/v1/garages/${encodeURIComponent(garageId)}/job-cards/${encodeURIComponent(jobId)}/parts`, {
      method: 'POST',
      body: JSON.stringify({ lines, note }),
    }),
};

let current: GarageClient = httpClient;

export const garages = (): GarageClient => current;

/** Tests swap in an in-memory garage. */
export function setGarageClient(client: GarageClient | null): void {
  current = client ?? httpClient;
}
