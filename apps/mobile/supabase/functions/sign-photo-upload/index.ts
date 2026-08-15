// Mints a presigned R2 PUT URL for one capture photo/video, and returns the exact
// x-amz-meta-* headers the client must attach to that PUT (R2/S3 presigned URLs sign
// whatever headers are included, so client and signer must agree on them).
//
// This is the ONLY reason a server exists for photo upload: R2 credentials can't ship
// to the client. Everything else (creating the capture row, listing claims, checking
// resume status) is a plain RLS-protected `supabase.from(...)` call from the app now —
// see apps/mobile/lib/capture-api.ts and lib/claims-api.ts.
//
// Ported 1:1 from claims-privacy's app/main.py::upload_capture_photo (extension
// inference, R2 key/folder layout) and app/r2_metadata.py (metadata building). Keep
// these two in sync by hand if either changes — the two repos share no code.

import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ENDPOINT_URL = Deno.env.get("R2_ENDPOINT_URL")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME")!;

const PRESIGN_EXPIRES_SECONDS = 300;

const _PLACEHOLDER_CLAIMANT_NAME = "UNKNOWN";
const _PLACEHOLDER_CLAIMANT_NIC = "000000000000";
const _PLACEHOLDER_CLAIMANT_LICENCE = "UNKNOWN";
const _PLACEHOLDER_VEHICLE_MODEL = "UNKNOWN";
const _PLACEHOLDER_POLICY_NUMBER = "UNKNOWN";

const _VIDEO_CT_TO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".webm",
};
const _IMAGE_CT_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
};
const _KNOWN_SUFFIX = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".mp4", ".mov", ".m4v", ".webm"]);
const _VIDEO_SUFFIX = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const _IMAGE_SUFFIX = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif"]);

function inferUploadExtension(filename: string | null, contentType: string | null): string {
  const suffixMatch = (filename ?? "").trim().toLowerCase().match(/\.[a-z0-9]+$/);
  const suffix = suffixMatch ? suffixMatch[0] : "";
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("video/")) {
    if (_VIDEO_SUFFIX.has(suffix)) return suffix;
    return _VIDEO_CT_TO_EXT[ct] ?? ".mp4";
  }
  if (ct.startsWith("image/")) {
    if (_IMAGE_SUFFIX.has(suffix)) return suffix;
    return _IMAGE_CT_TO_EXT[ct] ?? ".jpg";
  }
  if (_KNOWN_SUFFIX.has(suffix)) return suffix;
  return ".jpg";
}

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

function asciiMetaValue(value: string | null | undefined, maxLen = 900): string {
  if (value == null) return "";
  const text = String(value).replace(/[\r\n]/g, " ").trim();
  // deno-lint-ignore no-control-regex
  return text.replace(/[^\x00-\x7F]/g, "?").slice(0, maxLen);
}

function numStr(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return String(Number(v));
}

type CaptureRow = {
  id: string;
  status: string;
  created_at: string;
  claimant_name: string | null;
  claimant_nic: string | null;
  claimant_licence_number: string | null;
  vehicle_model: string | null;
  policy_number: string | null;
  vehicle_reg_no: string | null;
};

function buildPhotoObjectMetadata(
  capture: CaptureRow,
  photoIndex: number,
  assetKind: string,
  gpsLat: number | null,
  gpsLng: number | null,
  gpsAccuracy: number | null,
  capturedAtClient: string | null
): Record<string, string> {
  const meta: Record<string, string> = {
    "capture-id": asciiMetaValue(capture.id),
    "photo-index": String(Math.trunc(photoIndex)),
    "asset-kind": asciiMetaValue(assetKind),
    "claimant-name": asciiMetaValue(capture.claimant_name || _PLACEHOLDER_CLAIMANT_NAME),
    "claimant-nic": asciiMetaValue(capture.claimant_nic || _PLACEHOLDER_CLAIMANT_NIC),
    "claimant-licence": asciiMetaValue(capture.claimant_licence_number || _PLACEHOLDER_CLAIMANT_LICENCE),
    "vehicle-model": asciiMetaValue(capture.vehicle_model || _PLACEHOLDER_VEHICLE_MODEL),
    "policy-number": asciiMetaValue(capture.policy_number || _PLACEHOLDER_POLICY_NUMBER),
    "vehicle-reg-no": asciiMetaValue(capture.vehicle_reg_no),
    "photo-gps-lat": numStr(gpsLat),
    "photo-gps-lng": numStr(gpsLng),
    "photo-gps-accuracy": numStr(gpsAccuracy),
    "photo-captured-at": asciiMetaValue(capturedAtClient),
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== ""));
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

  const {
    captureId,
    photoIndex,
    assetKind = "original",
    photoSlot = "walkaround",
    filename = null,
    contentType,
    gpsLat = null,
    gpsLng = null,
    gpsAccuracy = null,
    capturedAtClient = null,
  } = await req.json();

  if (assetKind !== "original" && assetKind !== "enhanced") {
    return new Response(JSON.stringify({ error: "asset_kind must be 'original' or 'enhanced'." }), { status: 400 });
  }

  // RLS-scoped read (the user's own JWT is on this client) — a capture that isn't
  // theirs simply won't come back, same "404 rather than 403" behavior the old
  // _load_owned_capture() deliberately had, without needing to write that check by hand.
  const { data: capture, error: captureErr } = await supabase
    .from("captures")
    .select("id, status, created_at, claimant_name, claimant_nic, claimant_licence_number, vehicle_model, policy_number, vehicle_reg_no")
    .eq("id", captureId)
    .maybeSingle<CaptureRow>();

  if (captureErr || !capture) {
    return new Response(JSON.stringify({ error: "Capture session not found." }), { status: 404 });
  }
  if (capture.status !== "uploading") {
    return new Response(JSON.stringify({ error: "Capture session is not accepting uploads." }), { status: 409 });
  }

  if (assetKind === "enhanced") {
    const { data: original } = await supabase
      .from("capture_photos")
      .select("id")
      .eq("capture_id", captureId)
      .eq("photo_index", photoIndex)
      .eq("asset_kind", "original")
      .maybeSingle();
    if (!original) {
      return new Response(
        JSON.stringify({ error: "Upload the original for this photo_index before uploading enhanced." }),
        { status: 400 }
      );
    }
  }

  const extension = inferUploadExtension(filename, contentType);
  const parent = buildParentFolderName(capture.claimant_name, capture.claimant_nic, capture.created_at);
  let subfolder =
    photoSlot === "user-verification"
      ? "step-2-fraud-validation/user-verification"
      : photoSlot === "third-party"
      ? "step-2-fraud-validation/third-party"
      : "step-1-photos-uploaded";
  if (assetKind === "enhanced") subfolder += "/enhanced";
  const token = crypto.randomUUID().replace(/-/g, "");
  const key = `${parent}/${subfolder}/${String(photoIndex).padStart(3, "0")}-${token}${extension}`;

  const metadata = buildPhotoObjectMetadata(capture, photoIndex, assetKind, gpsLat, gpsLng, gpsAccuracy, capturedAtClient);

  const s3 = new S3Client({
    endpoint: R2_ENDPOINT_URL,
    region: "auto",
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    // Newer AWS SDK v3 defaults to attaching flexible-checksum headers R2 doesn't
    // handle correctly on presigned URLs, causing SignatureDoesNotMatch even with
    // correct credentials — restore the old/compatible behavior explicitly.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // The actual root cause of the SignatureDoesNotMatch errors: the SDK defaults to
    // virtual-hosted-style addressing (bucket.endpoint/key), which R2's generic
    // .r2.cloudflarestorage.com domain doesn't support — it needs path-style
    // (endpoint/bucket/key). Confirmed by diffing against a working boto3-generated
    // URL, which uses path-style by default.
    forcePathStyle: true,
  });

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType || "application/octet-stream",
    Metadata: metadata,
  });
  // R2 requires every x-amz-meta-* header actually sent on the PUT to be part of
  // X-Amz-SignedHeaders — unlike AWS S3, it rejects the SDK's default behavior of
  // "hoisting" these into query-string parameters instead of listing them as
  // required headers (that hoisted form causes SignatureDoesNotMatch on R2, even
  // though the values match). Forcing them unhoistable keeps them as real signed
  // headers, which R2 validates correctly. Confirmed by isolated testing against
  // the live bucket. Content-Type doesn't need this — R2 accepts it unsigned.
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
    unhoistableHeaders: new Set(Object.keys(metadata).map((k) => `x-amz-meta-${k}`)),
  });

  // The client must PUT with exactly this Content-Type and these x-amz-meta-* headers
  // (lowercased, without the x-amz-meta- prefix here — the client adds that prefix),
  // or the presigned signature won't match.
  return new Response(
    JSON.stringify({
      uploadUrl,
      key,
      contentType: contentType || "application/octet-stream",
      metadataHeaders: metadata,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
