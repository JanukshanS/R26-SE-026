"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useCameraStream, capturePhotoBlob, isVideoReadyToCapture } from "@/lib/claimFlow/camera";
import { requestMotionPermission, useTiltDegrees } from "@/lib/claimFlow/motion";
import { isTiltAligned, tiltHintFor } from "@/lib/claimFlow/tiltStatus";
import { enqueueUpload } from "@/lib/claimFlow/uploadQueue";
import { getCurrentCoords } from "@/lib/claimFlow/location";
import { HEIGHT_STEPS, type HeightStep } from "@/lib/claimFlow/types";
import { ViewfinderBrackets, type TiltAlignState } from "./illustrations/ViewfinderBrackets";
import { CaptureProgressRing } from "./illustrations/CaptureProgressRing";
import { OrbitDiagram } from "./illustrations/OrbitDiagram";

const STOP_COUNT = 12;
const TOTAL_PHOTOS = STOP_COUNT * HEIGHT_STEPS.length;

const PRIMARY_BTN =
  "w-full rounded-md bg-[#f97316] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const GHOST_BTN =
  "w-full rounded-md border border-input px-5 py-3 text-sm font-medium hover:bg-accent disabled:opacity-50";

const HEIGHT_LABEL_KEY: Record<HeightStep, string> = {
  overhead: "claim.guided.heightOverhead",
  chest: "claim.guided.heightChest",
  waist: "claim.guided.heightWaist",
};
const REFERENCE_IMAGE: Record<HeightStep, string> = {
  overhead: "/claim/overhead.png",
  chest: "/claim/chest.png",
  waist: "/claim/waist.png",
};
const REFERENCE_TITLE_KEY: Record<HeightStep, string> = {
  overhead: "claim.guided.poseOverheadTitle",
  chest: "claim.guided.poseChestTitle",
  waist: "claim.guided.poseWaistTitle",
};
const REFERENCE_INSTRUCTION_KEY: Record<HeightStep, string> = {
  overhead: "claim.guided.poseOverheadInstruction",
  chest: "claim.guided.poseChestInstruction",
  waist: "claim.guided.poseWaistInstruction",
};
const TILT_HINT_KEY: Record<string, string> = {
  good: "claim.guided.tiltGood",
  downMore: "claim.guided.tiltDownMore",
  upALittle: "claim.guided.tiltUpALittle",
  upright: "claim.guided.tiltUpright",
};

/** Same two-phase split as apps/mobile's capture.tsx: "posing" shows the
 * static reference photo for this height (no camera yet); "aiming" shows the
 * live camera + tilt-guided viewfinder. */
type Phase =
  | { kind: "posing" | "aiming"; stopIndex: number; height: HeightStep }
  | { kind: "walking"; fromStop: number };

/**
 * Web port of apps/mobile's Guided Capture. Each photo is *enqueued* (see
 * uploadQueue.ts) rather than awaited — the UI advances immediately so
 * taking all 36 photos feels as fast as the app, while uploads happen in the
 * background. A browser tab can't buffer 36 full photos in memory across a
 * possible reload the way the app's on-disk storage can, so this still
 * enqueues per-photo (durable almost immediately) rather than batching
 * everything until the very end.
 */
export function GuidedCaptureStep({
  captureId,
  startPhotoIndex,
  resumeUploadedCount,
  onPhotoUploaded,
  onAllStopsDone,
}: {
  captureId: string;
  /** Running index across the whole capture (walkaround, then licence, etc.) — see progress.ts. */
  startPhotoIndex: number;
  /** How many walkaround photos are already on the server, for resuming mid-walkaround after a reload. */
  resumeUploadedCount: number;
  onPhotoUploaded: (nextPhotoIndex: number) => void;
  onAllStopsDone: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [motionGranted, setMotionGranted] = useState(false);
  const [motionRequested, setMotionRequested] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const photoIndexRef = useRef(startPhotoIndex);

  const initialPhase = useMemo<Phase>(() => {
    const stopIndex = Math.floor(resumeUploadedCount / HEIGHT_STEPS.length);
    const heightIdx = resumeUploadedCount % HEIGHT_STEPS.length;
    return { kind: "posing", stopIndex, height: HEIGHT_STEPS[heightIdx] };
    // Only ever read once — the phase machine owns its own state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [uploadedCount, setUploadedCount] = useState(resumeUploadedCount);

  const isAiming = phase.kind === "aiming";
  const { stream, error: cameraError } = useCameraStream("environment", false, true);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const onEnableMotion = async () => {
    setMotionRequested(true);
    const result = await requestMotionPermission();
    setMotionGranted(result === "granted");
  };
  // Non-iOS browsers need no explicit gate — request once on mount so the UI
  // doesn't show an unnecessary "enable" button there.
  useEffect(() => {
    void requestMotionPermission().then((r) => {
      if (r === "granted") {
        setMotionGranted(true);
        setMotionRequested(true);
      }
    });
  }, []);

  const tiltDeg = useTiltDegrees(isAiming);
  const aligned = isAiming && tiltDeg != null ? isTiltAligned(tiltDeg, phase.height) : false;
  const tiltState: TiltAlignState = !isAiming ? "aligning" : aligned ? "steady" : tiltDeg == null ? "aligning" : "almost";

  const onReady = () => {
    if (phase.kind === "posing") {
      setPhase({ kind: "aiming", stopIndex: phase.stopIndex, height: phase.height });
    }
  };

  const onCapture = async () => {
    if (phase.kind !== "aiming" || !aligned || capturing) return;
    const video = videoRef.current;
    if (!video) return;
    setCaptureError(null);
    if (!isVideoReadyToCapture(video)) {
      setCaptureError(t("claim.guided.cameraNotReady"));
      return;
    }
    setCapturing(true);
    try {
      const capturedAtIso = new Date().toISOString();
      const [blob, gps] = await Promise.all([capturePhotoBlob(video), getCurrentCoords()]);
      const photoIndex = photoIndexRef.current;
      enqueueUpload({
        captureId,
        photoIndex,
        photoSlot: "walkaround",
        blob,
        filename: "walkaround.jpg",
        contentType: "image/jpeg",
        capturedAtIso,
        gps,
      });
      photoIndexRef.current = photoIndex + 1;
      const nextUploadedCount = uploadedCount + 1;
      setUploadedCount(nextUploadedCount);
      onPhotoUploaded(photoIndexRef.current);

      const heightIdx = HEIGHT_STEPS.indexOf(phase.height);
      const nextHeight = HEIGHT_STEPS[heightIdx + 1];
      if (nextHeight) {
        setPhase({ kind: "posing", stopIndex: phase.stopIndex, height: nextHeight });
      } else if (nextUploadedCount >= TOTAL_PHOTOS) {
        onAllStopsDone();
      } else {
        setPhase({ kind: "walking", fromStop: phase.stopIndex });
      }
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : t("claim.guided.cameraNotReady"));
    } finally {
      setCapturing(false);
    }
  };

  const onManualNext = () => {
    if (phase.kind === "walking") {
      setPhase({ kind: "posing", stopIndex: phase.fromStop + 1, height: HEIGHT_STEPS[0] });
    }
  };

  const currentStopIndex = phase.kind === "walking" ? phase.fromStop : phase.stopIndex;

  return (
    <div className="space-y-3">
      {/* Hidden during "aiming" — on a phone viewport this title+body plus a
          fixed-aspect (so width-driven, often taller than the screen) video
          box pushed the capture button below the fold, forcing a scroll for
          every single one of 36 photos. Dropping this text (redundant once
          the user is mid-shot) and switching the video box to a
          viewport-height cap below are what get the button back on-screen. */}
      {phase.kind !== "aiming" && (
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.guided.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("claim.guided.body")}</p>
        </div>
      )}

      <p className="text-sm font-medium">
        {t("claim.guided.stopLabel", { index: currentStopIndex + 1, total: STOP_COUNT })} · {uploadedCount}/{TOTAL_PHOTOS}
      </p>

      {/* The <video> stays mounted for this component's whole lifetime (just
          hidden via CSS outside "aiming") rather than being conditionally
          rendered per phase — swapping it out for the reference <img> (or
          nothing, during "walking") unmounts it, and the effect that attaches
          srcObject only re-runs when the `stream` object itself changes,
          which it doesn't between posing/aiming (same camera the whole way
          through). A freshly remounted <video> with no srcObject has 0
          width/height, so capturing from it produces an empty canvas — this
          is the exact bug that broke every single photo here before.

          Height is capped by viewport (dvh), not a fixed aspect ratio tied to
          width — aspect-[3/4] at full width made the box itself taller than
          most phone screens, which was the actual cause of "have to scroll
          down to take the picture". */}
      <div className={`relative h-[38dvh] w-full overflow-hidden rounded-xl border border-border bg-black ${phase.kind === "aiming" ? "" : "hidden"}`}>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {phase.kind === "aiming" && (
          <>
            <ViewfinderBrackets state={tiltState} />
            <div className="absolute right-3 top-3">
              <CaptureProgressRing current={uploadedCount} total={TOTAL_PHOTOS} />
            </div>
          </>
        )}
      </div>

      {cameraError && <p className="text-sm text-red-600">{t("claim.guided.cameraError")}</p>}

      {phase.kind === "walking" ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-6 text-center">
          <div className="flex justify-center">
            <OrbitDiagram stopCount={STOP_COUNT} targetStopIndex={phase.fromStop + 1} />
          </div>
          <p className="font-medium">{t("claim.guided.keepWalking")}</p>
          <p className="text-sm text-muted-foreground">{t("claim.guided.walkHint")}</p>
          <button type="button" onClick={onManualNext} className={PRIMARY_BTN}>
            {t("claim.guided.manualNext")}
          </button>
        </div>
      ) : phase.kind === "posing" ? (
        <div className="space-y-4">
          <div className="flex justify-center overflow-hidden rounded-xl border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REFERENCE_IMAGE[phase.height]}
              alt=""
              className="aspect-[4/3] w-full max-w-xs rounded-lg object-contain"
            />
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-bold tracking-tight">{t(REFERENCE_TITLE_KEY[phase.height])}</p>
            <p className="mt-1 text-sm font-bold text-[#f97316]">{t("claim.guided.standBack")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(REFERENCE_INSTRUCTION_KEY[phase.height])}</p>
          </div>
          <button type="button" onClick={onReady} className={PRIMARY_BTN}>
            {t("claim.guided.ready")}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {motionRequested && !motionGranted && (
            <button type="button" onClick={() => void onEnableMotion()} className={GHOST_BTN}>
              {t("claim.guided.enableMotion")}
            </button>
          )}
          <p className="text-sm text-muted-foreground">{t(HEIGHT_LABEL_KEY[phase.height])}</p>
          <p className={`text-sm font-medium ${aligned ? "text-green-700" : "text-amber-700"}`}>
            {t(TILT_HINT_KEY[tiltDeg != null ? tiltHintFor(tiltDeg, phase.height) : "upright"])}
          </p>
          {captureError && <p className="text-sm text-red-600">{captureError}</p>}
          <button
            type="button"
            onClick={() => void onCapture()}
            disabled={!aligned || capturing || !!cameraError}
            className={PRIMARY_BTN}
          >
            <span className="flex items-center justify-center gap-2">
              <Camera className="size-4" aria-hidden />
              {t("claim.guided.takePhoto")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
