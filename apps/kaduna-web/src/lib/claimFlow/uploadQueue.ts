"use client";

import { useEffect, useState } from "react";
import { uploadCaptureMedia, type PhotoSlot } from "./uploadApi";

export type UploadJob = {
  captureId: string;
  photoIndex: number;
  photoSlot: PhotoSlot;
  blob: Blob;
  filename: string;
  contentType: string;
  capturedAtIso: string;
  gps: { lat: number; lng: number; accuracy: number | null } | null;
};

type QueueState = {
  /** Not-yet-confirmed jobs, oldest first. */
  pending: UploadJob[];
  /** True while the current head-of-queue job is actively retrying after a failure —
   * distinct from "pending", so the UI can say "retrying" instead of just "queued". */
  retrying: boolean;
};

/**
 * Singleton, in-memory, strictly-sequential upload queue — this is what lets
 * capture steps advance immediately instead of waiting on each photo's own
 * network round-trip (see GuidedCaptureStep/PhotoSlotsStep/VideoStep).
 *
 * Sequential on purpose: photo_index must be confirmed in order for
 * reconcileProgress()'s simple "count of confirmed rows = next index" check
 * to stay valid, and a mobile connection handles one steady upload better
 * than several competing for the same limited bandwidth.
 *
 * A failing job retries forever with capped exponential backoff rather than
 * giving up — "never silently drop a photo" matters more here than fast
 * failure, and a temporary dead zone right after an accident is a very real
 * scenario for exactly this feature.
 */
const MAX_BACKOFF_MS = 30_000;

let state: QueueState = { pending: [], retrying: false };
let pumping = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function setState(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  notify();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (state.pending.length > 0) {
      const job = state.pending[0];
      let attempt = 0;
      for (;;) {
        try {
          await uploadCaptureMedia(job);
          break;
        } catch {
          attempt += 1;
          setState({ retrying: true });
          const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      setState({ pending: state.pending.slice(1), retrying: false });
    }
  } finally {
    pumping = false;
  }
}

export function enqueueUpload(job: UploadJob): void {
  setState({ pending: [...state.pending, job] });
  void pump();
}

export function waitForQueueDrain(): Promise<void> {
  if (state.pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (state.pending.length === 0) {
        listeners.delete(check);
        resolve();
      }
    };
    listeners.add(check);
  });
}

export function useUploadQueueStatus(): { pendingCount: number; retrying: boolean } {
  const [snapshot, setSnapshot] = useState({ pendingCount: state.pending.length, retrying: state.retrying });
  useEffect(() => {
    const onChange = () => setSnapshot({ pendingCount: state.pending.length, retrying: state.retrying });
    listeners.add(onChange);
    onChange();
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return snapshot;
}
