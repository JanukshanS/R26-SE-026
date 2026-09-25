"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Video } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useCameraStream, useMirroredRecorder } from "@/lib/claimFlow/camera";
import { enqueueUpload } from "@/lib/claimFlow/uploadQueue";
import { getCurrentCoords, type PhotoGps } from "@/lib/claimFlow/location";
import { playRecordStartSound, playRecordStopSound } from "@/lib/claimFlow/sounds";

const RECORD_DURATION_MS = 40_000;

const PRIMARY_BTN =
  "w-full rounded-md bg-[#f97316] px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-50";
const GHOST_BTN =
  "flex-1 rounded-md border border-input px-5 py-3 text-sm font-medium transition-transform duration-150 hover:bg-accent active:scale-[0.97] disabled:opacity-50";

/**
 * User Verification (mobile's "drunk-test"): a 40s front-camera + mic
 * recording. Recorded MIRRORED to match the live preview — see
 * useMirroredRecorder's doc comment for why that needs re-drawing frames
 * onto a canvas rather than just recording the raw camera stream.
 *
 * The read-aloud script (exact copy from apps/mobile's drunk-test.tsx) is
 * shown throughout — gated on there being no video yet, not on whether
 * recording is in progress, matching the app: the claimant reads it live
 * while recording, not from memory of a screen that's already disappeared.
 */
export function VideoStep({
  captureId,
  photoIndex,
  licenceNumber,
  onPhotoUploaded,
  onDone,
}: {
  captureId: string;
  photoIndex: number;
  licenceNumber: string;
  onPhotoUploaded: (nextPhotoIndex: number) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { stream, error: cameraError } = useCameraStream("user", true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { recording, videoBlob, start } = useMirroredRecorder(stream);
  const [secondsLeft, setSecondsLeft] = useState(RECORD_DURATION_MS / 1000);
  const [uploaded, setUploaded] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const capturedAtIsoRef = useRef<string>("");
  const gpsPromiseRef = useRef<Promise<PhotoGps | null>>(Promise.resolve(null));

  useEffect(() => {
    if (videoRef.current && stream && !videoBlob) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoBlob]);

  useEffect(() => {
    if (!recording) return;
    setSecondsLeft(RECORD_DURATION_MS / 1000);
    const interval = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (videoBlob && videoRef.current) {
      previewUrlRef.current = URL.createObjectURL(videoBlob);
      videoRef.current.srcObject = null;
      videoRef.current.src = previewUrlRef.current;
      videoRef.current.muted = false;
      void videoRef.current.play();
    }
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [videoBlob]);

  const onStart = () => {
    capturedAtIsoRef.current = new Date().toISOString();
    gpsPromiseRef.current = getCurrentCoords();
    playRecordStartSound();
    start(RECORD_DURATION_MS, () => playRecordStopSound());
  };

  const onRetake = () => {
    window.location.reload(); // simplest correct reset of the recorder/canvas/video graph
  };

  const onConfirm = async () => {
    if (!videoBlob) return;
    const gps = await gpsPromiseRef.current;
    enqueueUpload({
      captureId,
      photoIndex,
      photoSlot: "user-verification",
      blob: videoBlob,
      filename: "verification.webm",
      contentType: videoBlob.type || "video/webm",
      capturedAtIso: capturedAtIsoRef.current,
      gps,
    });
    onPhotoUploaded(photoIndex + 1);
    setUploaded(true);
  };

  if (cameraError) {
    return <p className="text-sm text-red-600">{t("claim.userVerification.micCameraNeeded")}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.userVerification.title")}</h1>
        <p className="mt-1 text-sm font-medium">
          {t(videoBlob ? "claim.userVerification.headlineDone" : "claim.userVerification.headlineStart")}
        </p>
      </div>

      {/* The script is long enough on its own to push the camera/button below
          the fold — it's already internally scrollable (overflow-y-auto), so
          shrinking the visible slice (max-h-48 -> max-h-28) trades "read it
          all at a glance" for "camera + button visible without scrolling the
          whole page", while the full text is still reachable by scrolling
          just this box. Once recording actually starts, the claimant needs
          to be reading this, not watching themselves — the video shrinks to
          a small self-check strip and this grows to show (most or all of)
          the script at once instead. */}
      {!videoBlob && (
        <div
          className={`overflow-y-auto rounded-xl bg-[#fff0e6] px-4 py-3 transition-[max-height] duration-300 ${
            recording ? "max-h-[46dvh]" : "max-h-28"
          }`}
        >
          <p className="text-sm leading-relaxed text-[#111111]">
            {t("claim.userVerification.script", {
              licence: licenceNumber.trim() || t("claim.userVerification.licencePlaceholder"),
            })}
          </p>
        </div>
      )}

      {/* h-[46dvh] matches GuidedCaptureStep/PhotoSlotsStep's preview size —
          shrinks while recording (see above), but not too far: at 16dvh the
          portrait camera feed under object-cover was cropped down to just
          eyes/forehead. 28dvh keeps the whole face visible. */}
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-border bg-black transition-[height] duration-300 ${
          recording ? "h-[28dvh]" : "h-[46dvh]"
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={!videoBlob}
          controls={!!videoBlob}
          className="h-full w-full object-cover"
          style={!videoBlob ? { transform: "scaleX(-1)" } : undefined}
        />
        {recording && (
          <div className="absolute inset-x-0 bottom-0 space-y-1 bg-white/60 px-4 py-2 text-center backdrop-blur-sm">
            <p className="flex items-center justify-center gap-2 text-xs font-bold text-red-600">
              <span className="size-2 animate-pulse rounded-full bg-red-600" aria-hidden />
              {t("claim.userVerification.recordingLabel")} · {t("claim.userVerification.recording", { seconds: secondsLeft })}
            </p>
          </div>
        )}
      </div>
      {recording && <p className="text-center text-xs text-muted-foreground">{t("claim.userVerification.stayInFrame")}</p>}

      {!stream ? null : uploaded ? (
        <button type="button" onClick={onDone} className={PRIMARY_BTN}>
          {t("claim.common.continue")}
        </button>
      ) : videoBlob ? (
        <div className="flex gap-3">
          <button type="button" onClick={onRetake} className={GHOST_BTN}>
            <span className="flex items-center justify-center gap-2">
              <RotateCcw className="size-4" aria-hidden /> {t("claim.userVerification.retake")}
            </span>
          </button>
          <button type="button" onClick={() => void onConfirm()} className={`flex-1 ${PRIMARY_BTN}`}>
            {t("claim.common.continue")}
          </button>
        </div>
      ) : recording ? null : (
        <button type="button" onClick={onStart} className={PRIMARY_BTN}>
          <span className="flex items-center justify-center gap-2">
            <Video className="size-4" aria-hidden /> {t("claim.userVerification.start")}
          </span>
        </button>
      )}
    </div>
  );
}
