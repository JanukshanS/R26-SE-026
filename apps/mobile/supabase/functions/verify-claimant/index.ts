// Public (no caller auth required) — the web "report without the app" claim-link
// flow's identity-confirm step. Looks up the real profile/vehicle/insurer behind a
// claimant's NIC + plate number, so the claimant page can pre-fill their name and
// resolve which insurer to call, without ever exposing that lookup to a plain
// anonymous session (profiles/vehicles are owner-scoped by RLS — an anonymous
// claimant session can't read someone else's row there).
//
// Uses the service-role key specifically to bypass that RLS for this one narrow,
// read-only, non-enumerable lookup (exact NIC + exact plate must both match the
// same driver) — never exposed to the client, only used inside this function.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Escapes Postgres LIKE metacharacters (%, _, and the escape char itself)
 * before handing a value to .ilike() — without this, a caller sending e.g.
 * nic="%" or a NIC substring turns what's meant to be an exact (just
 * case-insensitive) match into a wildcard/partial-match probe over PII this
 * public, unauthenticated, service-role-privileged function exposes. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type ProfileRow = {
  id: string;
  name: string | null;
  nic_number: string | null;
  licence_number: string | null;
};

type VehicleRow = {
  id: string;
  user_id: string;
  model: string;
  plate_number: string;
};

type VehicleInsuranceRow = {
  vehicle_id: string;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_expire_month: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { nic, plateNumber } = await req.json().catch(() => ({}));
  if (typeof nic !== "string" || !nic.trim() || typeof plateNumber !== "string" || !plateNumber.trim()) {
    return jsonResponse({ error: "nic and plateNumber are required." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, name, nic_number, licence_number")
    .ilike("nic_number", escapeLikePattern(nic.trim()))
    .maybeSingle<ProfileRow>();

  if (!profile) {
    return jsonResponse({ error: "No record matches that NIC and vehicle." }, 404);
  }

  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id, user_id, model, plate_number")
    .ilike("plate_number", escapeLikePattern(plateNumber.trim()))
    .maybeSingle<VehicleRow>();

  // Both must resolve, and to the SAME driver — a real NIC paired with someone
  // else's plate number is not a match, same as if neither existed at all.
  if (!vehicle || vehicle.user_id !== profile.id) {
    return jsonResponse({ error: "No record matches that NIC and vehicle." }, 404);
  }

  const { data: insurance } = await admin
    .from("vehicle_insurance")
    .select("vehicle_id, insurance_provider, insurance_policy_number, insurance_expire_month")
    .eq("vehicle_id", vehicle.id)
    .maybeSingle<VehicleInsuranceRow>();

  return jsonResponse({
    fullName: profile.name ?? "",
    licenceNumber: profile.licence_number ?? "",
    vehicleId: vehicle.id,
    vehicleModel: vehicle.model,
    plateNumber: vehicle.plate_number,
    insuranceProvider: insurance?.insurance_provider ?? null,
    policyNumber: insurance?.insurance_policy_number ?? null,
    insuranceExpireMonth: insurance?.insurance_expire_month ?? null,
  });
});
