import { supabase } from "@/lib/supabase";

/**
 * Port of apps/mobile/lib/capture-api.ts for the browser. Same backend (the
 * captures/capture_photos tables + sign-photo-upload/complete-capture Edge
 * Functions), same per-file-immediate-upload shape — the only real
 * difference is *when* things upload: the app buffers every file on disk and
 * uploads the whole bundle on "Report Accident"; the web flow can't safely
 * buffer 36+ photos + a video in browser memory across a possible reload, so
 * each step uploads its own media as soon as it's captured (see
 * GuidedCaptureStep, PhotoSlotsStep, VideoStep). Only small JSON (which
 * capture id, how many photos so far) needs to survive a reload — see
 * progress.ts.
 */

export type PhotoSlot = "walkaround" | "user-verification" | "third-party";

/** Creates the capture row once (first entry point that has a claimant/report
 * payload — Call Insurer, in this flow), or reuses one already in progress
 * for this uploadKey. */
export async function getOrCreateCapture(params: {
  existingCaptureId: string | null;
  createPayload: Record<string, unknown>;
}): Promise<string> {
  if (params.existingCaptureId) {
    const { data } = await supabase
      .from("captures")
      .select("status")
      .eq("id", params.existingCaptureId)
      .maybeSingle();
    if (data?.status === "uploading") {
      return params.existingCaptureId;
    }
    // Row vanished or moved past "uploading" (e.g. a prior attempt already
    // completed it) — fall through and start a fresh one below.
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw new Error("Not signed in yet.");
  }
  const { data: capture, error } = await supabase
    .from("captures")
    .insert({ ...params.createPayload, user_id: userId, status: "uploading" })
    .select("id")
    .single();
  if (error || !capture) {
    throw new Error(`Could not start the claim: ${error?.message ?? "unknown error"}`);
  }
  return capture.id as string;
}

type SignPhotoUploadResponse = {
  uploadUrl: string;
  key: string;
  contentType: string;
  metadataHeaders: Record<string, string>;
};

/** Uploads one photo/video: asks sign-photo-upload for a presigned R2 PUT URL,
 * PUTs the blob straight to R2, then records the row in Supabase. upsert (not
 * insert), same reason as the app: a retry after a failed attempt updates the
 * existing row instead of hard-failing on the unique constraint. */
export async function uploadCaptureMedia(params: {
  captureId: string;
  photoIndex: number;
  photoSlot: PhotoSlot;
  blob: Blob;
  filename: string;
  contentType: string;
  /** The moment this photo/video was actually captured (not upload time —
   * a review/confirm step can sit in between). */
  capturedAtIso: string;
  /** Best-effort GPS fix taken at capture time — null when denied/unavailable/timed out. */
  gps: { lat: number; lng: number; accuracy: number | null } | null;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("sign-photo-upload", {
    body: {
      captureId: params.captureId,
      photoIndex: params.photoIndex,
      assetKind: "original",
      photoSlot: params.photoSlot,
      filename: params.filename,
      contentType: params.contentType,
      gpsLat: params.gps?.lat ?? null,
      gpsLng: params.gps?.lng ?? null,
      gpsAccuracy: params.gps?.accuracy ?? null,
      capturedAtClient: params.capturedAtIso,
    },
  });
  if (error || !data) {
    throw new Error(`Failed to get an upload URL: ${error?.message ?? "unknown error"}`);
  }
  const { uploadUrl, key, contentType, metadataHeaders } = data as SignPhotoUploadResponse;

  const headers: Record<string, string> = { "Content-Type": contentType };
  for (const [metaKey, metaValue] of Object.entries(metadataHeaders)) {
    headers[`x-amz-meta-${metaKey}`] = metaValue;
  }

  const putRes = await fetch(uploadUrl, { method: "PUT", headers, body: params.blob });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status}).`);
  }

  const { error: insertError } = await supabase.from("capture_photos").upsert(
    {
      capture_id: params.captureId,
      photo_index: params.photoIndex,
      asset_kind: "original",
      r2_key: key,
      content_type: contentType,
      byte_size: params.blob.size,
      gps_lat: params.gps?.lat ?? null,
      gps_lng: params.gps?.lng ?? null,
      gps_accuracy: params.gps?.accuracy ?? null,
      captured_at_client: params.capturedAtIso,
    },
    { onConflict: "capture_id,photo_index,asset_kind" }
  );
  if (insertError) {
    throw new Error(`Failed to save photo metadata: ${insertError.message}`);
  }
}

export async function completeCapture(captureId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("complete-capture", {
    body: { captureId },
  });
  if (error || !data) {
    throw new Error(`Could not finish the claim: ${error?.message ?? "unknown error"}`);
  }
}

/** Patches columns on an already-created capture row (e.g. guided_capture_start_*,
 * drunk_test_start_*, report_* once each of those moments actually happens) —
 * RLS's captures_update_own policy allows this for the row's own owner. */
export async function updateCapture(captureId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("captures").update(patch).eq("id", captureId);
  if (error) {
    throw new Error(`Could not update the claim: ${error.message}`);
  }
}

export async function fetchCaptureStatus(captureId: string): Promise<string | null> {
  const { data } = await supabase.from("captures").select("status").eq("id", captureId).maybeSingle();
  return data?.status ?? null;
}

/**
 * Corrects a resumed `nextPhotoIndex` against what's actually confirmed on
 * the server. Needed because capture now advances (and bumps the local
 * counter) as soon as a photo is enqueued, not once its upload is confirmed
 * (see uploadQueue.ts) — a reload while items are still queued would
 * otherwise leave local progress claiming more is on the server than really
 * is.
 *
 * Uses the longest *contiguous* run of indices starting at 0, not a raw row
 * count — a plain count silently breaks the moment there's a gap (e.g.
 * indices 0-12 confirmed, then a dropped run, then 39-42 confirmed after a
 * later stage succeeded): the count is 17, but the true safe resume point is
 * 13. Counting rows instead of walking the run would then wrongly resume
 * from 17, permanently skipping the missing 13-38 without ever re-prompting
 * for them.
 */
export async function reconcileProgress(captureId: string, localNextPhotoIndex: number): Promise<number> {
  const { data } = await supabase
    .from("capture_photos")
    .select("photo_index")
    .eq("capture_id", captureId)
    .eq("asset_kind", "original")
    .order("photo_index", { ascending: true });

  const confirmedIndices = new Set((data ?? []).map((row) => row.photo_index as number));
  let contiguous = 0;
  while (confirmedIndices.has(contiguous)) contiguous += 1;

  return Math.min(localNextPhotoIndex, contiguous);
}
