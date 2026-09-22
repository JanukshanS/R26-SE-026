"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useCameraStream, capturePhotoBlob, type FacingMode } from "@/lib/claimFlow/camera";
import { enqueueUpload } from "@/lib/claimFlow/uploadQueue";
import { type PhotoSlot } from "@/lib/claimFlow/uploadApi";
import { getCurrentCoords, type PhotoGps } from "@/lib/claimFlow/location";

export type PhotoSlotDef = {
  key: string;
  labelKey: string;
  /** Instructional copy specific to this slot (mobile shows different text
   * per side, e.g. licence front vs. back vs. selfie) — not one static body
   * for the whole step. */
  bodyKey: string;
  facingMode: FacingMode;
};

const PRIMARY_BTN =
  "w-full rounded-md bg-[#f97316] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const GHOST_BTN =
  "flex-1 rounded-md border border-input px-5 py-3 text-sm font-medium hover:bg-accent disabled:opacity-50";

/**
 * Reusable "photograph up to N fixed slots" step — Driving Licence (front,
 * back, selfie) and Third-Party (their licence front/back, revenue licence)
 * are the same interaction with a different slot list, mirroring how the app
 * shares this shape between driving-licence.tsx and third-party.tsx.
 *
 * Each confirmed photo is *enqueued* (see uploadQueue.ts), not awaited — the
 * step advances immediately, same non-blocking pattern as GuidedCaptureStep.
 */
export function PhotoSlotsStep({
  titleKey,
  doneBodyKey,
  slots,
  photoSlot,
  captureId,
  startPhotoIndex,
  resumeCount,
  onPhotoUploaded,
  onAllDone,
}: {
  titleKey: string;
  /** Shown once every slot is captured (mobile: "All set — review your photos below."). */
  doneBodyKey: string;
  slots: PhotoSlotDef[];
  photoSlot: PhotoSlot;
  captureId: string;
  startPhotoIndex: number;
  /** How many of these slots are already uploaded — resumes past them after a reload. */
  resumeCount: number;
  onPhotoUploaded: (nextPhotoIndex: number) => void;
  onAllDone: () => void;
}) {
  const t = useT();
  const [slotIndex, setSlotIndex] = useState(Math.min(resumeCount, slots.length));
  const slot = slots[slotIndex];
  const { stream, error: cameraError } = useCameraStream(slot?.facingMode ?? "environment", false, true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoIndexRef = useRef(startPhotoIndex);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const capturedAtIsoRef = useRef<string>("");
  const gpsPromiseRef = useRef<Promise<PhotoGps | null>>(Promise.resolve(null));
  const [completedThumbs, setCompletedThumbs] = useState<(string | null)[]>(() => slots.map(() => null));

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (slotIndex >= slots.length) onAllDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotIndex]);

  const onCapture = async () => {
    const video = videoRef.current;
    if (!video) return;
    capturedAtIsoRef.current = new Date().toISOString();
    gpsPromiseRef.current = getCurrentCoords();
    const blob = await capturePhotoBlob(video);
    setPreview({ blob, url: URL.createObjectURL(blob) });
  };

  const onRetake = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const onConfirm = async () => {
    if (!preview) return;
    const gps = await gpsPromiseRef.current;
    const photoIndex = photoIndexRef.current;
    enqueueUpload({
      captureId,
      photoIndex,
      photoSlot,
      blob: preview.blob,
      filename: `${slot.key}.jpg`,
      contentType: "image/jpeg",
      capturedAtIso: capturedAtIsoRef.current,
      gps,
    });
    setCompletedThumbs((prev) => {
      const next = [...prev];
      next[slotIndex] = preview.url;
      return next;
    });
    photoIndexRef.current += 1;
    onPhotoUploaded(photoIndexRef.current);
    setPreview(null);
    setSlotIndex((i) => i + 1);
  };

  const onRetakeSlot = (i: number) => {
    if (preview) URL.revokeObjectURL(preview.url);
    photoIndexRef.current = startPhotoIndex + i;
    setPreview(null);
    setSlotIndex(i);
  };

  if (!slot) return null;

  const allDone = slotIndex >= slots.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(allDone ? doneBodyKey : slot.bodyKey)}</p>
      </div>

      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            allDone ? "bg-[#00db7e] text-white" : "bg-[#fdecdc] text-[#f97316]"
          }`}
        >
          {allDone && <Check className="size-3.5" aria-hidden />}
          {t("claim.common.stepNOf3", { index: Math.min(slotIndex + 1, slots.length), label: t(slot.labelKey) })}
        </span>
        {completedThumbs.some(Boolean) && (
          <div className="flex gap-2">
            {completedThumbs.map((url, i) =>
              url ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onRetakeSlot(i)}
                  className="relative size-12 overflow-hidden rounded-lg border border-border"
                  aria-label={t("claim.licence.retake")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-white shadow">
                    <RotateCcw className="size-2.5 text-[#f97316]" aria-hidden />
                  </span>
                </button>
              ) : null
            )}
          </div>
        )}
      </div>

      {!allDone && (
        <>
          <p className="text-sm font-medium">{t(slot.labelKey)}</p>

          {cameraError ? (
            <p className="text-sm text-red-600">{t("claim.guided.cameraError")}</p>
          ) : (
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-black">
              {/* The <video> stays mounted across slot changes even while a preview
                  is showing — swapping it out for an <img> (unmounting it) loses
                  the camera stream binding, since the effect that attaches
                  srcObject only re-runs when the `stream` object itself changes,
                  which it doesn't between two slots using the same-facing camera
                  (e.g. licence front -> back). A freshly remounted <video> with no
                  srcObject has 0 width/height, so capturing from it produces an
                  empty canvas — exactly what broke the "back" slot. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${preview ? "hidden" : ""}`}
                style={slot.facingMode === "user" ? { transform: "scaleX(-1)" } : undefined}
              />
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
          )}

          {!preview ? (
            <button type="button" onClick={() => void onCapture()} disabled={!!cameraError} className={PRIMARY_BTN}>
              <span className="flex items-center justify-center gap-2">
                <Camera className="size-4" aria-hidden /> {t("claim.licence.takePhoto")}
              </span>
            </button>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={onRetake} className={GHOST_BTN}>
                <span className="flex items-center justify-center gap-2">
                  <RotateCcw className="size-4" aria-hidden /> {t("claim.licence.retake")}
                </span>
              </button>
              <button type="button" onClick={() => void onConfirm()} className={`flex-1 ${PRIMARY_BTN}`}>
                {t("claim.common.continue")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
