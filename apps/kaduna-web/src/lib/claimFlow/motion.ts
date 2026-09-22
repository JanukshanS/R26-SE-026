"use client";

import { useEffect, useRef, useState } from "react";

const SENSOR_SMOOTHING_ALPHA = 0.3;

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};
type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** iOS 13+ Safari gates both deviceorientation and devicemotion behind one
 * user-gesture-triggered permission prompt; every other browser (Android
 * Chrome included) needs no such prompt at all. Call this from a click
 * handler, before subscribing to either event. */
export async function requestMotionPermission(): Promise<"granted" | "denied" | "unsupported"> {
  if (typeof DeviceOrientationEvent === "undefined") {
    return "unsupported";
  }
  const withPermission = DeviceOrientationEvent as DeviceOrientationEventWithPermission;
  if (typeof withPermission.requestPermission !== "function") {
    // Not iOS — no gate to pass.
    return "granted";
  }
  try {
    const orientationResult = await withPermission.requestPermission();
    const motionCtor = DeviceMotionEvent as DeviceMotionEventWithPermission;
    const motionResult =
      typeof motionCtor.requestPermission === "function" ? await motionCtor.requestPermission() : "granted";
    return orientationResult === "granted" && motionResult === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Phone tilt, degrees, in the SAME convention as apps/mobile's
 * accelerometer-based pitch (use-guided-capture.ts): 0° = held upright in
 * portrait facing the user, larger magnitude = tipped forward/down.
 *
 * `deviceorientation`'s `beta` uses a different zero point — 0° is flat
 * face-up on a table, and ~90° is upright/portrait — so it's remapped
 * (`beta - 90`) before use. Without this remap, every tilt threshold reads
 * backwards: the "chest"/"waist" alignment (meant to require holding the
 * phone upright) would instead unlock when the phone is laid flat.
 */
export function useTiltDegrees(enabled: boolean): number | null {
  const [pitch, setPitch] = useState<number | null>(null);
  const filterRef = useRef({ value: 0, hasSample: false });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    filterRef.current = { value: 0, hasSample: false };
    setPitch(null);

    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null) return;
      const raw = e.beta - 90;
      const f = filterRef.current;
      if (!f.hasSample) {
        f.value = raw;
        f.hasSample = true;
      } else {
        f.value = SENSOR_SMOOTHING_ALPHA * raw + (1 - SENSOR_SMOOTHING_ALPHA) * f.value;
      }
      setPitch(f.value);
    };

    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [enabled]);

  return pitch;
}
