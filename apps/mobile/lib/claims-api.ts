import { supabase } from '@lib/supabase';
import { getActiveSessionId } from '@/lib/session-guard';

/**
 * Claim history, backed directly by Supabase Postgres (RLS-protected: every row is
 * scoped to the signed-in user by `auth.uid()`) — previously a separate claims-privacy
 * FastAPI service backed by Neon Postgres. Public shape below (`ClaimSummary`,
 * `listMyClaims()`, `getCachedClaims()`) is unchanged from that migration so every
 * screen that already consumes this file needed no changes.
 */

export type ClaimSummary = {
  id: string;
  status: string;
  createdAt: string;
  vehicleModel?: string;
  policyNumber?: string;
  vehicleRegNo?: string;
  locationLabel?: string;
  capturedAtDisplayLocal?: string;
};

type ClaimSummaryRow = {
  id: string;
  status: string;
  created_at: string;
  vehicle_model: string | null;
  policy_number: string | null;
  vehicle_reg_no: string | null;
  report_location_label: string | null;
  report_captured_at_display_local: string | null;
};

function mapClaim(row: ClaimSummaryRow): ClaimSummary {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    vehicleModel: row.vehicle_model ?? undefined,
    policyNumber: row.policy_number ?? undefined,
    vehicleRegNo: row.vehicle_reg_no ?? undefined,
    locationLabel: row.report_location_label ?? undefined,
    capturedAtDisplayLocal: row.report_captured_at_display_local ?? undefined,
  };
}

// Populated by listMyClaims() on every call, and prefetched once at login (see
// vehicleContext.tsx) so callers that don't need up-to-the-second freshness — e.g.
// Home's Insurance button, which only needs "is there a finished claim" to decide
// where to navigate — can read it instantly instead of paying a network round trip
// on every tap. The My Claims list screen still calls listMyClaims() directly for a
// guaranteed-fresh fetch every time it's opened; it doesn't read this cache.
// Cleared on logout so it can never leak into a different account signing in on the
// same device.
let cachedClaims: ClaimSummary[] | null = null;

export function getCachedClaims(): ClaimSummary[] | null {
  return cachedClaims;
}

export function clearCachedClaims(): void {
  cachedClaims = null;
}

/**
 * The signed-in driver's claim history, newest first. Returns `[]` for a guest
 * session — same graceful degradation as the rest of the claim-upload flow,
 * not an error.
 *
 * No explicit `.eq('user_id', ...)` filter is needed — RLS already scopes the
 * result set to the caller, same convention as `vehicleApi.ts`'s `getVehicles()`.
 */
export async function listMyClaims(): Promise<ClaimSummary[]> {
  const requestedFor = getActiveSessionId();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return [];
  }

  const { data, error } = await supabase
    .from('captures')
    .select(
      'id, status, created_at, vehicle_model, policy_number, vehicle_reg_no, report_location_label, report_captured_at_display_local'
    )
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const claims = (data as ClaimSummaryRow[]).map(mapClaim);
  // A slower request from an account that has since logged out must not clobber a
  // newer account's cache once it finally resolves — see session-guard.ts.
  if (getActiveSessionId() === requestedFor) {
    cachedClaims = claims;
  }
  return claims;
}
