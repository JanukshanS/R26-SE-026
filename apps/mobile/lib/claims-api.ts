import { getAccessToken, getCaptureApiBaseUrl } from '@/lib/capture-api';

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

/**
 * The signed-in driver's claim history, newest first. Returns `[]` for a guest
 * session — same graceful degradation as the rest of the claim-upload flow,
 * not an error.
 *
 * Which claims come back is decided by the backend from the bearer token, so
 * there is nothing to pass: the old `?nic=` parameter let any caller read any
 * driver's history.
 */
export async function listMyClaims(): Promise<ClaimSummary[]> {
  const token = await getAccessToken();
  if (!token) {
    return [];
  }

  const base = getCaptureApiBaseUrl();
  if (!base) {
    return [];
  }

  // fetch() has no default timeout in React Native — an unreachable backend
  // (wrong LAN IP, server not running) would otherwise hang the screen's
  // loading spinner indefinitely instead of surfacing an error.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(`${base}/claims`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Could not reach the server. Check EXPO_PUBLIC_API_URL and that the backend is running.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`Failed to load claims (${res.status}).`);
  }
  const rows = (await res.json()) as ClaimSummaryRow[];
  return rows.map(mapClaim);
}
