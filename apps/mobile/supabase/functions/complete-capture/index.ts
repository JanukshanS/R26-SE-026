// Finalizes a capture: validates the minimum-photo-count rule, marks it "processing",
// and best-effort writes locations/locations.json into the claim's R2 folder (needs R2
// credentials, so — like sign-photo-upload — this one step can't be done client-side).
//
// Ported 1:1 from claims-privacy's app/main.py::complete_capture +
// _write_locations_to_r2. Keep in sync by hand if either changes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ENDPOINT_URL = Deno.env.get("R2_ENDPOINT_URL")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME")!;
// Matches claims-privacy's Settings.min_capture_photos (.env.example documents 6;
// the Python class default is 5 — override via this function's own env if needed).
const MIN_CAPTURE_PHOTOS = Number(Deno.env.get("MIN_CAPTURE_PHOTOS") ?? "6");

const _PLACEHOLDER_CLAIMANT_NAME = "UNKNOWN";
const _PLACEHOLDER_CLAIMANT_NIC = "000000000000";

function formatFolderTimestamp(createdAt: string | null): string {
  if (!createdAt) return "";
  const dt = new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}-${pad(dt.getUTCMinutes())}-${pad(dt.getUTCSeconds())}Z`
  );
}

function buildParentFolderName(name: string | null, nic: string | null, createdAt: string | null): string {
  const resolvedName = name?.trim() || _PLACEHOLDER_CLAIMANT_NAME;
  const resolvedNic = nic?.trim() || _PLACEHOLDER_CLAIMANT_NIC;
  const safeName = resolvedName.replace(/[/\\]/g, "-");
  const safeNic = resolvedNic.replace(/[/\\]/g, "-");
  let folder = `${safeName} - ${safeNic}`;
  const ts = formatFolderTimestamp(createdAt);
  if (ts) folder += ` - ${ts}`;
  return folder;
}

const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const ts = (v: unknown): string | null => (v == null ? null : String(v));

type CaptureRow = {
  id: string;
  status: string;
  created_at: string;
  claimant_name: string | null;
  claimant_nic: string | null;
  insurer_call_at: string | null;
  insurer_call_gps_lat: number | null;
  insurer_call_gps_lng: number | null;
  insurer_call_location_permission: string | null;
  insurer_call_location_label: string | null;
  insurer_call_captured_at_display_local: string | null;
  guided_capture_started_at: string | null;
  guided_capture_start_gps_lat: number | null;
  guided_capture_start_gps_lng: number | null;
  guided_capture_start_location_permission: string | null;
  guided_capture_start_location_label: string | null;
  guided_capture_start_captured_at_display_local: string | null;
  report_captured_at: string | null;
  report_gps_lat: number | null;
  report_gps_lng: number | null;
  report_location_label: string | null;
  report_captured_at_display_local: string | null;
};

async function writeLocationsToR2(capture: CaptureRow): Promise<void> {
  const payload = {
    insurer_call: {
      captured_at: ts(capture.insurer_call_at),
      captured_at_display_local: ts(capture.insurer_call_captured_at_display_local),
      gps_lat: num(capture.insurer_call_gps_lat),
      gps_lng: num(capture.insurer_call_gps_lng),
      location_permission: ts(capture.insurer_call_location_permission),
      location_label: ts(capture.insurer_call_location_label),
    },
    guided_capture_started: {
      captured_at: ts(capture.guided_capture_started_at),
      captured_at_display_local: ts(capture.guided_capture_start_captured_at_display_local),
      gps_lat: num(capture.guided_capture_start_gps_lat),
      gps_lng: num(capture.guided_capture_start_gps_lng),
      location_permission: ts(capture.guided_capture_start_location_permission),
      location_label: ts(capture.guided_capture_start_location_label),
    },
    report_submitted: {
      captured_at: ts(capture.report_captured_at),
      captured_at_display_local: ts(capture.report_captured_at_display_local),
      gps_lat: num(capture.report_gps_lat),
      gps_lng: num(capture.report_gps_lng),
      location_label: ts(capture.report_location_label),
    },
  };
  const parent = buildParentFolderName(capture.claimant_name, capture.claimant_nic, capture.created_at);
  const s3 = new S3Client({
    endpoint: R2_ENDPOINT_URL,
    region: "auto",
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    // See sign-photo-upload/index.ts for why these are needed with R2.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // See sign-photo-upload/index.ts — R2's generic endpoint needs path-style addressing.
    forcePathStyle: true,
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `${parent}/locations/locations.json`,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json",
    })
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { captureId } = await req.json();

  const { data: capture, error: captureErr } = await supabase
    .from("captures")
    .select("*")
    .eq("id", captureId)
    .maybeSingle<CaptureRow>();

  if (captureErr || !capture) {
    return new Response(JSON.stringify({ error: "Capture session not found." }), { status: 404 });
  }
  if (capture.status !== "uploading") {
    return new Response(JSON.stringify({ error: "Capture session is already completed." }), { status: 409 });
  }

  const { count: originalCount } = await supabase
    .from("capture_photos")
    .select("id", { count: "exact", head: true })
    .eq("capture_id", captureId)
    .eq("asset_kind", "original");

  if ((originalCount ?? 0) < MIN_CAPTURE_PHOTOS) {
    return new Response(
      JSON.stringify({ error: `Not enough original photos uploaded. Minimum required: ${MIN_CAPTURE_PHOTOS}.` }),
      { status: 400 }
    );
  }

  const completedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("captures")
    .update({ status: "processing", completed_at: completedAt })
    .eq("id", captureId)
    .select("id, status, created_at, completed_at")
    .maybeSingle();

  if (updateErr || !updated) {
    return new Response(JSON.stringify({ error: "Capture session could not be completed." }), { status: 409 });
  }

  try {
    await writeLocationsToR2(capture);
  } catch (exc) {
    // Best-effort, matches claims-privacy's original behavior: log and continue,
    // the capture is still marked processing either way.
    console.error("Failed to write locations.json to R2 — continuing anyway", exc);
  }

  const { count: enhancedCount } = await supabase
    .from("capture_photos")
    .select("id", { count: "exact", head: true })
    .eq("capture_id", captureId)
    .eq("asset_kind", "enhanced");

  return new Response(
    JSON.stringify({
      id: updated.id,
      status: updated.status,
      created_at: updated.created_at,
      completed_at: updated.completed_at,
      uploaded_photo_count: originalCount ?? 0,
      uploaded_enhanced_count: enhancedCount ?? 0,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
