/**
 * Owns the engine monitor's lifecycle and the auto-recording seam.
 *
 * Mounted once in `app/(driver)/_layout.tsx` rather than in a screen: the
 * monitor has to outlive any single screen, and `home.tsx` unmounts on
 * `router.replace` (logout, auth changes).
 *
 * WHAT IT DOES NOW
 * ----------------
 * Engine start -> `startTrip(..., { origin: "auto" })`.
 * Engine stop  -> `endTrip()` and a durable submit, or `abortTrip()` when the
 * drive is obviously not worth sending. This was observe-only until the
 * voltage thresholds in `engineMonitor.ts` were calibrated against a real
 * Toyota Aqua; they now are (start detected in ~4.6s, stop in ~8.6s), so the
 * seam is live.
 *
 * MANUAL AND AUTO MUST NOT FIGHT
 * ------------------------------
 * Both paths drive the same single-trip recorder, so every interaction here is
 * gated on `isTripActive()` / `getTripOrigin()`:
 *   - auto-start never fires while ANY trip is running, so a manually started
 *     trip is not clobbered by the ignition being switched on;
 *   - auto-end only ever ends a trip whose origin is "auto", so a driver who
 *     started recording by hand keeps control of when it stops — being
 *     silently ended and submitted at a fuel stop would be indefensible;
 *   - a manual end simply leaves no active trip, which every path here
 *     tolerates.
 *
 * FOREGROUND-ONLY. Plain JS timers don't survive backgrounding on either
 * platform, so the monitor stops on background and restarts (with an immediate
 * poll) on foreground rather than pretending to keep running. What that means
 * for a trip that is mid-recording is spelled out at `onAppBackground` /
 * `onAppForeground` below.
 */

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { router } from "expo-router";

import { isAutoTripEnabled, loadAutoTripSettings } from "@lib/autoTripSettings";
import { isElm327Paired, isRealBackend, onPairingChange } from "@lib/elm327";
import {
  getEngineSnapshot,
  isEngineMonitorRunning,
  onEngineStateChange,
  retargetEngineMonitor,
  startEngineMonitor,
  stopEngineMonitor,
} from "@lib/engineMonitor";
import { flushPendingTrips, submitTripDurable } from "@lib/pendingTripStore";
import {
  abortTrip,
  endTrip,
  getMotionEvidence,
  getTripOrigin,
  getTripStats,
  isTripActive,
  startTrip,
} from "@lib/tripRecorder";
import { useVehicle } from "@lib/vehicleContext";

const LOG_TAG = "[AutoTrip]";

// ── Guardrail thresholds ──────────────────────────────────────────────────
//
// The backend rejects a trip with 422 when it is under MIN_TRIP_MINUTES (2.0)
// or at/under MIN_DISTANCE_KM (0.5) — see `routers/ingest.py`. A 422 is not
// harmful (the queue drops it permanently) but it is noise, and more
// importantly a trip that never moved is EVIDENCE OF A FALSE START rather than
// of a short drive: a battery charger, a jump start, or a remote-start warm-up
// can all raise the 12V bus without the car going anywhere. Those must be
// thrown away, not submitted, so the driver's history isn't littered with
// phantom drives.
//
// Everything below is checked against `getMotionEvidence()`, which only knows
// peak speed and elapsed time — the recorder does not keep a running distance.
// The tests are therefore deliberately CONSERVATIVE: each one aborts only when
// submission is certain to fail, and anything ambiguous is sent and left to
// the backend, which is authoritative and has the full sample series.

/**
 * Peak speed below which the vehicle demonstrably never moved. 5 km/h is
 * walking pace — under it, a reading is rolling in a car park at worst and
 * OBD speed-sensor noise at best. Set from the top of the trip, not an
 * average, so a long idle followed by one real drive still passes.
 */
const MIN_PEAK_SPEED_KMH = 5;

/**
 * Elapsed floor, normally 30s above the backend's 2-minute minimum. The margin
 * covers the backend preferring wall-clock duration only when it agrees with
 * the sensor-derived span to within 20%; a trip sitting exactly on 120s can
 * fall either side of the line depending on which source wins.
 *
 * DEMO OVERRIDE: EXPO_PUBLIC_MIN_TRIP_SEC lowers it, so a trip can be shown
 * end-to-end without idling an engine for two minutes.
 *
 * THIS MUST BE LOWERED ON BOTH SIDES OR IT DOES NOTHING USEFUL. The backend
 * has its own floor (MIN_TRIP_MINUTES in ingest.py); if only this one moves,
 * the app dutifully uploads a 40-second trip and the server rejects it with a
 * 422 — a worse outcome than the guardrail catching it locally, because the
 * trip is destroyed either way but now it takes a round trip and an opaque
 * error message to find out. Set MIN_TRIP_MINUTES on the backend to match.
 */
const MIN_ELAPSED_SEC = Number(process.env.EXPO_PUBLIC_MIN_TRIP_SEC ?? 150);

/**
 * Structural floor from the Pydantic schema (`min_length=2` on both arrays).
 * Worth checking on-device because it is reachable in a way the time/distance
 * floors are not: when a real dongle is paired but stops answering,
 * `captureObd` SKIPS the sample rather than fabricating one, so a trip during
 * which the ELM327 died can end with fewer OBD rows than minutes elapsed.
 */
const MIN_READINGS = 2;

/** Distance floor, mirroring the backend's MIN_DISTANCE_KM. Overridable for demos. */
const MIN_DISTANCE_KM = Number(process.env.EXPO_PUBLIC_MIN_TRIP_KM ?? 0.5);

/**
 * How long an auto trip keeps recording after the adapter goes unreachable.
 *
 * `adapter-lost` is explicitly NOT `engine-off` in the monitor's design, and
 * treating it as one would end a trip every time the phone slid off the seat
 * or the BLE link hiccuped in traffic. The engine is almost certainly still
 * running, and the IMU stream — which carries the entire driver-behaviour
 * block — is unaffected by the dongle being gone, so recording through a
 * dropout loses very little.
 *
 * Five minutes is where that stops being true. Past it the likeliest
 * explanation is no longer a hiccup but the dongle having been unplugged or
 * the driver having walked away from the car with the phone in a pocket, and
 * continuing would splice a walk (or a bus ride) onto the end of the drive and
 * feed it to the harsh-braking detector as if it were driving.
 */
const ADAPTER_LOST_GRACE_MS = 5 * 60_000;

/**
 * How long the app may be backgrounded before an active auto trip is closed
 * out on return. See `onAppForeground` for the reasoning.
 */
const BACKGROUND_MAX_MS = 30 * 60_000;

export function useAutoTripController(): void {
  const { selectedVehicle, user } = useVehicle();
  const vehicleId = selectedVehicle?.plateNumber ?? "CBD-3742";
  const driverId = user?._id ?? "guest";

  // Kept in refs so the sync effect below can read the current vehicle/driver
  // without tearing the monitor down and rebuilding it on every change.
  const vehicleIdRef = useRef(vehicleId);
  vehicleIdRef.current = vehicleId;
  const driverIdRef = useRef(driverId);
  driverIdRef.current = driverId;

  useEffect(() => {
    let cancelled = false;

    /** Deadline after which an adapter-lost auto trip gets closed out. */
    let adapterLostTimer: ReturnType<typeof setTimeout> | null = null;
    /** When the app last went to the background, or null while foregrounded. */
    let backgroundedAt: number | null = null;
    /**
     * Re-entrancy guard for `finishAutoTrip`. Three different callers can
     * decide a trip is over within the same second (`onEngineStop`, the
     * engine-off backstop, the adapter-lost deadline) and `endTrip()` is async
     * — without this, the second caller would find the trip already gone and
     * throw out of a handler nobody is catching.
     */
    let finishing = false;

    // Baseline voltages are persisted; load them before the first poll so the
    // rise-above-baseline test can fire on the very first drive of a session.
    // The enable flag lives in the same file, which is why nothing may
    // auto-start before this resolves.
    void loadAutoTripSettings().then(() => {
      if (cancelled) return;
      sync();
      void flushPendingTrips("app start");
    });

    // ── The auto-recording seam ───────────────────────────────────────────

    function handleEngineStart(): void {
      if (!isAutoTripEnabled()) {
        console.log(`${LOG_TAG} ENGINE START ignored — auto recording is switched off`);
        return;
      }
      if (isTripActive()) {
        // Normal and expected: the driver pressed Record before turning the
        // key, or the adapter dropped and re-confirmed the start mid-trip.
        console.log(
          `${LOG_TAG} ENGINE START ignored — a ${getTripOrigin()} trip is already recording`
        );
        return;
      }
      cancelAdapterLostDeadline();
      try {
        const tripId = startTrip(vehicleIdRef.current, driverIdRef.current, { origin: "auto" });
        console.log(
          `${LOG_TAG} ENGINE START -> auto trip ${tripId.slice(0, 8)} recording ` +
          `(vehicle=${vehicleIdRef.current} driver=${driverIdRef.current})`
        );

        // Show the live screen straight away. Recording that starts silently in
        // the background is indistinguishable from recording that failed to
        // start — the driver has no way to tell, and the first they would learn
        // of a problem is a trip missing from their history hours later.
        // Opening the screen makes the state visible at the moment it changes.
        //
        // `push`, not `replace`: whatever they were looking at stays on the
        // stack, so ending the trip returns them there rather than stranding
        // them somewhere they did not choose to be.
        try {
          router.push("/(driver)/active-trip");
        } catch (e) {
          // Navigation failing must never take the recording down with it.
          console.log(`${LOG_TAG} could not open the live trip screen: ${errText(e)}`);
        }
      } catch (e) {
        // startTrip only throws on an already-active trip, which is guarded
        // above — but this runs from a timer callback with no error boundary
        // above it, so a throw here would take the app down.
        console.log(`${LOG_TAG} could not start auto trip: ${errText(e)}`);
      }
    }

    function handleEngineStop(): void {
      void finishAutoTrip("engine stopped");
    }

    /**
     * End an auto trip and get it to the backend, or discard it if it is not
     * worth sending. The single exit point for every auto trip.
     */
    async function finishAutoTrip(reason: string): Promise<void> {
      if (finishing) return;
      if (!isTripActive()) return;

      const origin = getTripOrigin();
      if (origin !== "auto") {
        // The driver owns this trip. Ending it for them would be the worst
        // possible failure mode of the whole feature.
        console.log(
          `${LOG_TAG} ${reason}, but the active trip is MANUAL — leaving it to the driver`
        );
        return;
      }

      finishing = true;
      cancelAdapterLostDeadline();
      try {
        const evidence = getMotionEvidence();
        const stats = getTripStats();

        // Upper bound on distance: peak speed held for the entire trip. If
        // even that cannot clear the backend's 0.5 km floor, the real figure
        // certainly cannot, so a 422 is guaranteed and the POST is pure waste.
        const distanceCeilingKm = evidence
          ? (evidence.maxSpeedKmh * evidence.elapsedSec) / 3600
          : 0;

        if (!evidence) {
          abortTrip(`${reason} but no motion evidence available`);
          return;
        }
        if (evidence.maxSpeedKmh < MIN_PEAK_SPEED_KMH) {
          // The classic false start: something raised the 12V bus but the car
          // never moved.
          abortTrip(
            `${reason} — peak speed ${evidence.maxSpeedKmh.toFixed(1)}km/h is below ` +
            `${MIN_PEAK_SPEED_KMH}km/h, the vehicle never moved (charger/jump start/warm-up?)`
          );
          return;
        }
        if (evidence.elapsedSec < MIN_ELAPSED_SEC) {
          abortTrip(
            `${reason} — only ${evidence.elapsedSec}s elapsed, below the backend's ` +
            `2-minute floor (need ${MIN_ELAPSED_SEC}s with margin)`
          );
          return;
        }
        if (distanceCeilingKm <= MIN_DISTANCE_KM) {
          abortTrip(
            `${reason} — at most ${distanceCeilingKm.toFixed(2)}km covered ` +
            `(${evidence.maxSpeedKmh.toFixed(1)}km/h peak over ${evidence.elapsedSec}s), ` +
            `below the backend's ${MIN_DISTANCE_KM}km floor`
          );
          return;
        }
        if (stats && (stats.obdCount < MIN_READINGS || stats.imuCount < MIN_READINGS)) {
          // endTrip() takes one more of each, so being one short here is fine;
          // being two short is not recoverable.
          if (stats.obdCount < MIN_READINGS - 1 || stats.imuCount < MIN_READINGS - 1) {
            abortTrip(
              `${reason} — only ${stats.obdCount} OBD / ${stats.imuCount} IMU readings, ` +
              `below the schema's floor of ${MIN_READINGS} each (dongle stopped answering?)`
            );
            return;
          }
        }

        const batch = await endTrip();

        // Re-check after the final snapshots: `captureObd` skips the sample
        // outright when a paired dongle doesn't answer, which is exactly what
        // happens at the moment the ignition goes off.
        if (batch.obd_readings.length < MIN_READINGS || batch.imu_readings.length < MIN_READINGS) {
          console.log(
            `${LOG_TAG} DISCARDING finished auto trip ${batch.trip_id.slice(0, 8)}: ` +
            `${batch.obd_readings.length} OBD / ${batch.imu_readings.length} IMU readings ` +
            `is below the schema floor of ${MIN_READINGS} — the backend would 422 it`
          );
          return;
        }

        console.log(
          `${LOG_TAG} auto trip ${batch.trip_id.slice(0, 8)} finished (${reason}) — submitting`
        );
        const outcome = await submitTripDurable(batch);
        console.log(
          `${LOG_TAG} auto trip ${batch.trip_id.slice(0, 8)} ${outcome === "submitted"
            ? "accepted by the backend"
            : "could not be sent yet — held for retry on next foreground/pairing"}`
        );
      } catch (e) {
        // Nothing above this frame catches: these handlers run from the
        // monitor's setTimeout and from AppState events.
        console.log(`${LOG_TAG} finishing auto trip FAILED: ${errText(e)}`);
      } finally {
        finishing = false;
      }
    }

    // ── Adapter loss ──────────────────────────────────────────────────────

    function handleAdapterLost(sinceMs: number): void {
      console.log(`${LOG_TAG} adapter unreachable for ${Math.round(sinceMs / 1000)}s`);
      if (!isTripActive() || getTripOrigin() !== "auto") return;
      if (adapterLostTimer) return; // deadline already ticking

      console.log(
        `${LOG_TAG} auto trip continues without the dongle — IMU keeps recording; ` +
        `will close it out if the adapter is still gone in ${ADAPTER_LOST_GRACE_MS / 60_000}min`
      );
      adapterLostTimer = setTimeout(() => {
        adapterLostTimer = null;
        void finishAutoTrip("adapter gone past the grace period");
      }, ADAPTER_LOST_GRACE_MS);
    }

    function cancelAdapterLostDeadline(): void {
      if (!adapterLostTimer) return;
      clearTimeout(adapterLostTimer);
      adapterLostTimer = null;
    }

    /**
     * Backstop for the transition `onEngineStop` structurally cannot report.
     *
     * When the adapter drops and recovers, the monitor resets its counters and
     * re-enters `unknown`. If the engine was switched off during the blackout
     * — the adapter still answers, since pin 16 is unswitched — it then
     * settles `unknown -> engine-off`, and `tryConfirmStop` fires
     * `onEngineStop` only when the previous state was `running`. So the one
     * case where a trip most needs ending never reaches the handler, and the
     * trip would record forever. Watching the state directly covers it, and
     * `finishAutoTrip` is idempotent so the overlap with `onEngineStop` on the
     * normal path is harmless.
     */
    function handleEngineStateChange(snapshot: ReturnType<typeof getEngineSnapshot>): void {
      if (snapshot.state !== "adapter-lost") cancelAdapterLostDeadline();
      if (snapshot.state !== "engine-off") return;
      if (!isTripActive() || getTripOrigin() !== "auto") return;
      void finishAutoTrip("monitor settled on engine-off");
    }

    // ── Monitor lifecycle ─────────────────────────────────────────────────

    function sync(): void {
      const shouldRun =
        AppState.currentState === "active" && isElm327Paired() && isRealBackend();

      if (shouldRun) {
        startEngineMonitor({
          vehicleId: vehicleIdRef.current,
          handlers: {
            onEngineStart: handleEngineStart,
            onEngineStop: handleEngineStop,
            onAdapterLost: handleAdapterLost,
          },
        });
      } else {
        stopEngineMonitor();
      }
    }

    /**
     * An auto trip that is mid-recording SURVIVES backgrounding.
     *
     * Ending it here was the obvious alternative and is wrong: locking the
     * phone and putting it in a pocket is what a driver normally does thirty
     * seconds into a drive, so every real trip would be truncated to its first
     * moments and then rejected as too short. The recorder's own timers stall
     * while suspended, but the trip object survives, the IMU listeners resume
     * on return, and the backend already expects and caps the resulting
     * sampling gap (`MAX_SAMPLE_GAP_SEC`, logged there as "app was probably
     * backgrounded"). Only the monitor stops, because its polling is what
     * genuinely cannot run.
     */
    function onAppBackground(): void {
      backgroundedAt = Date.now();
      if (isTripActive() && getTripOrigin() === "auto") {
        console.log(
          `${LOG_TAG} backgrounding with an auto trip recording — trip kept, ` +
          `engine monitor paused until foreground`
        );
      }
      // The deadline is a JS timer and would not fire reliably while
      // suspended; the elapsed-time check on foreground replaces it.
      cancelAdapterLostDeadline();
      stopEngineMonitor(); // JS timers don't survive backgrounding
    }

    /**
     * The bound on the rule above: past BACKGROUND_MAX_MS the trip is closed
     * out instead of resumed.
     *
     * A blackout that long means nothing was recorded across it, so resuming
     * would stitch a prologue and an epilogue from two different parts of the
     * day into one "trip" with an invented hole in the middle — which the
     * backend's gap-capping would quietly compress rather than reject, making
     * the result plausible and wrong. Closing the book is honest: if the
     * engine is in fact still running, the monitor re-confirms it within a
     * couple of polls and simply starts a fresh trip.
     */
    function onAppForeground(): void {
      const awayMs = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
      backgroundedAt = null;

      if (awayMs > BACKGROUND_MAX_MS && isTripActive() && getTripOrigin() === "auto") {
        void finishAutoTrip(`app was backgrounded for ${Math.round(awayMs / 60_000)}min`);
      }

      sync();
      void flushPendingTrips("app foregrounded");
    }

    const unsubPairing = onPairingChange(() => {
      sync();
      // A dongle pairing is the strongest available signal that the phone is
      // in the car and awake, and it costs nothing when the queue is empty.
      void flushPendingTrips("dongle paired");
    });

    const unsubEngineState = onEngineStateChange(handleEngineStateChange);

    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") onAppForeground();
      else onAppBackground();
    });

    sync();

    return () => {
      cancelled = true;
      cancelAdapterLostDeadline();
      unsubPairing();
      unsubEngineState();
      appStateSub.remove();
      stopEngineMonitor();
      // An in-flight auto trip is deliberately NOT ended here. This unmounts
      // on logout and on auth changes, where the recorder's own state is torn
      // down anyway; ending and submitting a trip against a driver id that is
      // being signed out would attribute the drive to the wrong account.
    };
  }, []);

  // Re-target the monitor when the driver switches vehicles — resting-voltage
  // baselines are per-vehicle, so a stale id would compare against the wrong car.
  // Guarded on "already running" so this can never start the monitor with the
  // empty handler set; starting is the sync() effect's job alone.
  useEffect(() => {
    if (isEngineMonitorRunning()) retargetEngineMonitor(vehicleId);
  }, [vehicleId]);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
