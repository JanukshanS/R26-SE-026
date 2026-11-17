/**
 * The link between a garage's job and the car owner's Kaduna account: the
 * plate. Drivers register their cars (plate unique) in Supabase's
 * public.vehicles, which this service can't read for other people. So:
 *
 *   vehiclesOf(token)      the caller's own plates and when each was added,
 *                          read with their own token (RLS returns only their
 *                          rows). This decides which pickups, repairs and
 *                          bookings a driver sees, so a driver can never see
 *                          them for someone else's car. "since" keeps a
 *                          previous owner's finished history private.
 *   plateRegistered(...)   whether anyone has registered a plate, through the
 *                          optional `plate_is_registered` RPC (see
 *                          docs/supabase/plate-is-registered.sql). It only
 *                          says yes or no, never who. null when the RPC isn't
 *                          installed, so the garage is told "can't check"
 *                          rather than being blocked.
 *
 * Plates are compared compact (letters and digits only), because the app
 * stores "WP-CAB-1234" and a garage may have typed "WPCAB1234".
 */
import { config } from '../config';
import { logger } from '../utils/logger';

export const compactPlate = (plate: string | null | undefined): string | null => {
  const c = (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c || null;
};

export interface OwnedVehicle {
  /** Compact plate. */
  plate: string;
  /** When the caller registered it; null when unknown. */
  since: Date | null;
}

export interface VehicleLookup {
  vehiclesOf(token: string | undefined): Promise<OwnedVehicle[]>;
  plateRegistered(plate: string, token: string | undefined): Promise<boolean | null>;
}

const headers = (token: string) => ({ apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

const supabaseLookup: VehicleLookup = {
  async vehiclesOf(token) {
    if (!token || !config.supabaseUrl) return [];
    const res = await fetch(`${config.supabaseUrl}/rest/v1/vehicles?select=plate_number,created_at`, { headers: headers(token), signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`vehicle lookup HTTP ${res.status}`);
    const rows = (await res.json()) as { plate_number?: string | null; created_at?: string | null }[];
    return rows.flatMap((r) => {
      const plate = compactPlate(r.plate_number);
      return plate ? [{ plate, since: r.created_at ? new Date(r.created_at) : null }] : [];
    });
  },
  async plateRegistered(plate, token) {
    if (!token || !config.supabaseUrl) return null;
    try {
      const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/plate_is_registered`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ p_plate: plate }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      return Boolean(await res.json());
    } catch (err) {
      logger.warn(`plate_is_registered failed: ${(err as Error).message}`);
      return null;
    }
  },
};

let current: VehicleLookup = supabaseLookup;

export const vehicleLookup = (): VehicleLookup => current;

/** Just the caller's compact plates. */
export const platesOf = async (token: string | undefined) => (await current.vehiclesOf(token)).map((v) => v.plate);

/** Tests swap in their own owners and plates. */
export function setVehicleLookup(lookup: VehicleLookup | null): void {
  current = lookup ?? supabaseLookup;
}
