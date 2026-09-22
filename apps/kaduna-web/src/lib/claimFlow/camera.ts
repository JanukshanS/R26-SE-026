"use client";

import { useEffect, useRef, useState } from "react";

export type FacingMode = "environment" | "user";

/** Requests the highest resolution the device's camera actually supports —
 * "ideal" (not "min"/exact) so getUserMedia still succeeds by falling back to
 * whatever the camera/browser can do instead of failing outright. Photos feed
 * the 3D reconstruction pipeline (COLMAP + nerfstudio), which needs real
 * detail to find/match features across shots — the un-constrained default
 * resolution browsers pick (often ~640x480) is nowhere near enough for that. */
const HIGH_QUALITY_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 4096 },
  height: { ideal: 2304 },
};

/** Opens a camera stream (photo steps: no audio; video step passes audio itself)
 * and tears it down on unmount / facingMode change. Attach the returned stream
 * to a <video autoPlay playsInline muted={!audio}> element yourself, since the
 * element ref's lifecycle is the caller's (each step owns its own <video>).
 * `highQuality` requests max resolution — use it for anything that feeds the
 * 3D pipeline (Guided Capture, Driving Licence, Third-Party); leave it off for
 * the verification video, which doesn't need 4K and would just be a much
 * bigger upload for no benefit. */
export function useCameraStream(
  facingMode: FacingMode,
  audio = false,
  highQuality = false
): { stream: MediaStream | null; error: string | null } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let active: MediaStream | null = null;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera access isn't available in this browser.");
      return;
    }

    const videoConstraints: MediaTrackConstraints = highQuality
      ? { facingMode, ...HIGH_QUALITY_VIDEO_CONSTRAINTS }
      : { facingMode };

    navigator.mediaDevices
      .getUserMedia({ video: videoConstraints, audio })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        active = s;
        setStream(s);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open the camera.");
        }
      });

    return () => {
      cancelled = true;
      active?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [facingMode, audio, highQuality]);

  return { stream, error };
}

/** One still frame from a playing <video> element, as a JPEG Blob — the web
 * equivalent of CameraView.takePictureAsync(). Always the true (unmirrored)
 * frame regardless of how the preview itself is styled. High quality (0.95,
 * not the canvas-toBlob default 0.92) since this feeds 3D reconstruction —
 * compression artifacts hurt feature matching the same way low resolution does. */
export function capturePhotoBlob(video: HTMLVideoElement, quality = 0.95): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas not supported."));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not capture a photo."))),
      "image/jpeg",
      quality
    );
  });
}

const RECORDER_MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Records a front-camera stream MIRRORED — matching what the user actually saw
 * in the live preview, the same fix apps/mobile applies via CameraView's
 * `mirror` prop. MediaRecorder records a stream's raw (unmirrored) frames, so
 * getting a mirrored *file* out means re-drawing every frame flipped onto an
 * offscreen canvas and recording THAT canvas's stream instead of the camera's
 * — video track from the canvas, audio track passed through unchanged from
 * the source stream.
 */
export function useMirroredRecorder(sourceStream: MediaStream | null) {
  const [recording, setRecording] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      recorderRef.current?.stop();
      hiddenVideoRef.current?.pause();
    };
  }, []);

  const start = (durationMs: number, onDone: (blob: Blob) => void) => {
    if (!sourceStream || recording) return;
    const videoTrack = sourceStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    const width = settings.width ?? 720;
    const height = settings.height ?? 1280;

    // A second, hidden <video> plays the raw stream so we have a decoded
    // frame source to draw from — the visible preview element is the
    // caller's own, styled with CSS mirroring; this one is purely internal.
    const hiddenVideo = document.createElement("video");
    hiddenVideo.srcObject = sourceStream;
    hiddenVideo.muted = true;
    hiddenVideo.playsInline = true;
    hiddenVideoRef.current = hiddenVideo;
    void hiddenVideo.play();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(30);
    const audioTracks = sourceStream.getAudioTracks();
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

    chunksRef.current = [];
    const mimeType = pickRecorderMimeType();
    const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      hiddenVideo.pause();
      const blob = new Blob(chunksRef.current, { type: mimeType ?? "video/webm" });
      setVideoBlob(blob);
      setRecording(false);
      onDone(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);

    window.setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, durationMs);
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  return { recording, videoBlob, start, stop };
}
