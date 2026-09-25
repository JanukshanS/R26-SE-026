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
 * reconcileProgress()'s "longest contiguous run from 0" check to stay valid,
 * and a mobile connection handles one steady upload better than several
 * competing for the same limited bandwidth.
 *
 * A failing job retries forever with capped exponential backoff rather than
 * giving up — "never silently drop a photo" matters more here than fast
 * failure, and a temporary dead zone right after an accident is a very real
 * scenario for exactly this feature.
 *
 * Every job is ALSO persisted to IndexedDB (see below) the moment it's
 * enqueued, and removed only once its upload is confirmed. Without this, a
 * real-world capture session (36 walkaround photos + licence + video +
 * third-party can easily run 15-30+ minutes) that gets reloaded — phone
 * screen locks and the mobile browser reclaims the tab, user backgrounds it
 * long enough to get discarded, anything that tears down this JS module —
 * silently wipes every not-yet-confirmed job with it: `state.pending` starts
 * over empty in the fresh page load, `waitForQueueDrain()` there sees nothing
 * pending and resolves immediately, and the *already-advanced* local progress
 * counter (see PhotoSlotsStep/GuidedCaptureStep — it advances at enqueue
 * time, not confirmed-upload time) never gets asked to redo the lost photos.
 * This is exactly what happened in production: photos 13-38 (the rest of a
 * walkaround + all 3 driving-licence photos) vanished in one contiguous
 * block, while the video and third-party photos captured afterward, in a
 * fresh session, uploaded fine. IndexedDB persistence plus rehydrating on
 * module load (below) closes that gap — a reload no longer loses anything
 * that was already captured.
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

// ── IndexedDB persistence (durability across reload/tab-discard) ──────────

const DB_NAME = "kaduna-claim-upload-queue";
const STORE_NAME = "jobs";
const DB_VERSION = 1;

type StoredUploadJob = UploadJob & { id: string };

function jobId(job: UploadJob): string {
  return `${job.captureId}:${job.photoIndex}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistJob(job: UploadJob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ ...job, id: jobId(job) } satisfies StoredUploadJob);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removePersistedJob(job: UploadJob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(jobId(job));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadPersistedJobs(): Promise<UploadJob[]> {
  const db = await openDb();
  const rows = await new Promise<StoredUploadJob[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as StoredUploadJob[]);
    req.onerror = () => reject(req.error);
  });
  // Ascending by photoIndex — preserves the strictly-sequential upload order
  // even across a rehydrate, same as jobs enqueued fresh in one session.
  return rows.sort((a, b) => a.photoIndex - b.photoIndex).map(({ id: _id, ...job }) => job);
}

// Best-effort: IndexedDB is unavailable in some contexts (private browsing in
// older Safari, SSR) — persistence is a safety net on top of the in-memory
// queue, which still works fine within a single unbroken session either way.
const persistenceAvailable = typeof window !== "undefined" && typeof indexedDB !== "undefined";

// waitForQueueDrain() awaits this first (see below) — rehydrating from
// IndexedDB is itself async, so without this a drain-check racing ahead of
// it could see an empty `state.pending` and resolve before leftover jobs
// from a previous, abruptly-ended session even get re-added to the queue.
const rehydration: Promise<void> = persistenceAvailable
  ? loadPersistedJobs()
      .then((jobs) => {
        if (jobs.length === 0) return;
        setState({ pending: [...jobs, ...state.pending] });
        void pump();
      })
      .catch(() => {
        // Nothing left over, or IndexedDB errored reading it — either way, a
        // fresh in-memory queue for this session is still the correct fallback.
      })
  : Promise.resolve();

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
      if (persistenceAvailable) void removePersistedJob(job).catch(() => {});
      setState({ pending: state.pending.slice(1), retrying: false });
    }
  } finally {
    pumping = false;
  }
}

export function enqueueUpload(job: UploadJob): void {
  setState({ pending: [...state.pending, job] });
  if (persistenceAvailable) void persistJob(job).catch(() => {});
  void pump();
}

export async function waitForQueueDrain(): Promise<void> {
  await rehydration;
  if (state.pending.length === 0) return;
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
