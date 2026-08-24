/**
 * ============================================================================
 * Pending-trip store — durable submission queue for auto-recorded trips
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The manual end-trip path (`active-trip.tsx`) can afford to lose a failed
 * POST: a human is standing there, the alert says "Trip data is lost", and
 * they know to drive again. An AUTO trip has no such person. It ends when the
 * ignition goes off — typically in a basement car park with no signal, or with
 * the phone about to be locked and pocketed — and the raw OBD/IMU readings
 * live only in `tripRecorder`'s module state, which `teardown()` drops the
 * instant the batch is produced. A single failed fetch there silently destroys
 * a whole drive that can never be reconstructed.
 *
 * So the batch is written to disk BEFORE the first POST is attempted, and only
 * removed once the backend has confirmed it holds the trip. Everything else in
 * here is bookkeeping around that one rule.
 *
 * DISPOSITION OF A FAILED POST
 * ----------------------------
 * Retrying blindly is as wrong as not retrying at all — a batch the backend
 * will never accept would sit in the queue forever, re-POSTing a few hundred
 * kilobytes on every foreground. The status code decides:
 *
 *   2xx  stored          -> drop
 *   409  already stored  -> drop. A duplicate `trip_id` means an earlier
 *                           attempt actually landed and we lost the response
 *                           (timeout on a slow link is the usual cause). This
 *                           is a SUCCESS, not a failure.
 *   422  unprocessable   -> drop. Either too short for `MIN_TRIP_MINUTES` /
 *                           `MIN_DISTANCE_KM`, or structurally invalid per the
 *                           Pydantic schema. Neither improves with time.
 *   400  malformed       -> drop, same reasoning.
 *   else (5xx, 401,
 *   timeout, offline)    -> keep and retry on the next trigger.
 *
 * Retries are opportunistic, never scheduled: there is no background timer
 * (see the FOREGROUND-ONLY note in `use-auto-trip-controller.ts` — JS timers
 * do not survive backgrounding, so a retry timer would be a lie). The queue is
 * flushed when the app comes to the foreground and when the dongle pairs,
 * which between them cover every moment the app is alive and likely online.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { submitTrip, TripSubmitError, type TripBatch } from "./maintenanceApi";

const LOG_TAG = "[PendingTrips]";

const STORAGE_KEY = "kaduna.pendingTrips.v1";

/**
 * Hard cap on the queue. A batch is small (tens of OBD + IMU rows), but an
 * unbounded queue backed by a device that is offline for a fortnight is still
 * an unbounded write. When full the OLDEST entry is dropped rather than the
 * newest rejected: recent drives are the ones the health model actually needs.
 */
const MAX_QUEUED = 20;

/**
 * Give up on an entry after this many failed attempts. This is the backstop
 * for a failure mode the status codes cannot express — e.g. a batch that
 * reliably 500s because of one poisonous value in it. Roughly a fortnight of
 * daily use before anything is discarded.
 */
const MAX_ATTEMPTS = 30;

interface PendingTrip {
  batch: TripBatch;
  /** When the trip was first queued, for the age in logs. */
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

// ── Serialised persistence ────────────────────────────────────────────────
//
// Every mutation is read-modify-write on a single AsyncStorage key, so two
// overlapping callers (a trip ending while a flush is draining the queue) can
// interleave and lose one of the two writes. All mutations therefore go
// through one promise chain — same idiom as `autoTripSettings.persist()`.
// The chain deliberately holds only the disk work; the network calls in
// `flushPendingTrips` run OUTSIDE it, so a 15-second POST can never block a
// finishing trip from being written down.

let opChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.catch(() => undefined);
  return run;
}

async function readQueue(): Promise<PendingTrip[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Only entries that still carry a usable batch survive a shape change;
    // anything else would fail at POST time forever.
    return parsed.filter(
      (e): e is PendingTrip =>
        !!e && typeof e === "object" && !!(e as PendingTrip).batch?.trip_id
    );
  } catch (e) {
    console.log(`${LOG_TAG} queue unreadable, starting clean: ${errText(e)}`);
    return [];
  }
}

async function writeQueue(queue: PendingTrip[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.log(`${LOG_TAG} queue write FAILED: ${errText(e)}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/** How many trips are waiting to reach the backend. For debug UI and logs. */
export async function getPendingTripCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Persist a batch so it survives the app dying, then try to send it now.
 *
 * The ordering is the whole point: the write happens before the POST, so a
 * crash, a force-quit or a phone running out of battery mid-request still
 * leaves the drive recoverable on next launch. Resolves to whether the trip is
 * already safely at the backend; it does NOT reject on a network failure,
 * because "queued for later" is a normal, successful outcome here and there is
 * no caller to handle a rejection.
 */
export async function submitTripDurable(batch: TripBatch): Promise<"submitted" | "queued"> {
  await serialize(async () => {
    const queue = await readQueue();
    if (queue.some((e) => e.batch.trip_id === batch.trip_id)) return;
    queue.push({ batch, queuedAt: Date.now(), attempts: 0 });
    while (queue.length > MAX_QUEUED) {
      const dropped = queue.shift();
      console.log(
        `${LOG_TAG} queue full (${MAX_QUEUED}) — discarding oldest trip ` +
        `${short(dropped?.batch.trip_id)} to make room`
      );
    }
    await writeQueue(queue);
  });
  console.log(`${LOG_TAG} queued trip ${short(batch.trip_id)} before POST`);

  const sent = await attemptOne(batch.trip_id);
  return sent ? "submitted" : "queued";
}

let flushing: Promise<void> | null = null;

/**
 * Try to send everything in the queue. Safe to call at any time and from
 * anywhere; overlapping calls collapse into the one already running.
 */
export async function flushPendingTrips(reason: string): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const queue = await readQueue();
      if (queue.length === 0) return;
      console.log(`${LOG_TAG} flushing ${queue.length} queued trip(s) — ${reason}`);
      // Snapshot the ids and send one at a time. Sequential, not parallel: a
      // phone that just regained signal on a 3G cell handles one 15-second
      // upload far better than five, and ordering keeps the oldest drive from
      // being starved.
      for (const entry of queue) {
        await attemptOne(entry.batch.trip_id);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// ── Internals ─────────────────────────────────────────────────────────────

/**
 * Send one queued trip and apply the disposition table at the top of the file.
 * Re-reads the entry from disk rather than trusting a caller-held copy so a
 * concurrent drop can't resurrect it.
 *
 * Returns true only when the backend is known to hold the trip.
 */
async function attemptOne(tripId: string): Promise<boolean> {
  const entry = (await readQueue()).find((e) => e.batch.trip_id === tripId);
  if (!entry) return false;

  try {
    await submitTrip(entry.batch);
    await dropFromQueue(tripId, "stored by backend");
    return true;
  } catch (e) {
    const status = e instanceof TripSubmitError ? e.status : null;

    if (status === 409) {
      // Not an error: a previous attempt landed and we never saw the reply.
      await dropFromQueue(tripId, "already stored (409 duplicate)");
      return true;
    }

    if (status === 422 || status === 400) {
      await dropFromQueue(
        tripId,
        `PERMANENTLY rejected (HTTP ${status}: ${errText(e)}) — not retrying`
      );
      return false;
    }

    const attempts = await bumpAttempts(tripId, errText(e));
    if (attempts >= MAX_ATTEMPTS) {
      await dropFromQueue(
        tripId,
        `giving up after ${attempts} attempts (last: ${errText(e)})`
      );
      return false;
    }
    console.log(
      `${LOG_TAG} trip ${short(tripId)} still pending after attempt ${attempts} ` +
      `(${status === null ? "no response" : `HTTP ${status}`}: ${errText(e)})`
    );
    return false;
  }
}

async function dropFromQueue(tripId: string, why: string): Promise<void> {
  await serialize(async () => {
    const queue = await readQueue();
    const entry = queue.find((e) => e.batch.trip_id === tripId);
    const next = queue.filter((e) => e.batch.trip_id !== tripId);
    if (next.length !== queue.length) await writeQueue(next);
    const ageMin = entry ? (Date.now() - entry.queuedAt) / 60_000 : 0;
    console.log(
      `${LOG_TAG} trip ${short(tripId)} removed from queue after ${ageMin.toFixed(1)}min — ${why} ` +
      `(${next.length} still pending)`
    );
  });
}

async function bumpAttempts(tripId: string, lastError: string): Promise<number> {
  return serialize(async () => {
    const queue = await readQueue();
    const entry = queue.find((e) => e.batch.trip_id === tripId);
    if (!entry) return 0;
    entry.attempts += 1;
    entry.lastError = lastError;
    await writeQueue(queue);
    return entry.attempts;
  });
}

function short(tripId: string | undefined): string {
  return tripId ? tripId.slice(0, 8) : "?";
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
