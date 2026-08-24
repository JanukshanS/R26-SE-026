// Claim history for the driver portal. Ported from apps/mobile/lib/claims-api.ts —
// same `captures` table, same columns, same RLS scoping (rows are already filtered
// to auth.uid()). Read-only; mobile's login-time cache and session guard are not
// ported because the web tab always fetches on mount.
import { supabase } from "./supabase";

export type ClaimSummary = {
  id: string;
  status: string;
  createdAt: string;
  vehicleModel?: string;
  policyNumber?: string;
  vehicleRegNo?: string;
  locationLabel?: string;
  capturedAtDisplayLocal?: string;
  /**
   * How many photos the capture uploaded. The images themselves live in a
   * private R2 bucket keyed by `capture_photos.r2_key`, and the only edge
   * functions that exist are `sign-photo-upload` / `complete-capture` — there
   * is no read URL to build a thumbnail from, on web or on mobile.
   */
  photoCount: number;
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
  capture_photos: { count: number }[];
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
    photoCount: row.capture_photos?.[0]?.count ?? 0,
  };
}

/** The signed-in driver's claims, newest first. */
export async function listMyClaims(): Promise<ClaimSummary[]> {
  const { data, error } = await supabase
    .from("captures")
    .select(
      "id, status, created_at, vehicle_model, policy_number, vehicle_reg_no, report_location_label, report_captured_at_display_local, capture_photos(count)"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as ClaimSummaryRow[]).map(mapClaim);
}

/** `captures.status` in driver-facing terms — same wording as mobile's My Claims. */
export function claimStatusLabel(status: string): string {
  if (status === "uploading") return "In Progress";
  if (status === "processing") return "Submitted";
  if (status === "pending_review") return "Pending Review";
  if (status === "approved") return "Approved";
  return status;
}

/** A claim still moving through the pipeline, for the Overview stat card. */
export function claimInProgress(status: string): boolean {
  return status === "uploading" || status === "processing" || status === "pending_review";
}
