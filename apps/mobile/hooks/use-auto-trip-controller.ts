/**
 * Owns the engine monitor's lifecycle.
 *
 * Mounted once in `app/(driver)/_layout.tsx` rather than in a screen: the
 * monitor has to outlive any single screen, and `home.tsx` unmounts on
 * `router.replace` (logout, auth changes).
 *
 * OBSERVE-ONLY. `onEngineStart`/`onEngineStop` only log — they deliberately do
 * NOT call `startTrip`/`endTrip` yet. The voltage thresholds in
 * `engineMonitor.ts` need validating against a real car over several drives
 * first; these two callbacks are the single seam where auto-recording gets
 * switched on.
 *
 * FOREGROUND-ONLY. Plain JS timers don't survive backgrounding on either
 * platform, so the monitor stops on background and restarts (with an immediate
 * poll) on foreground rather than pretending to keep running.
 */

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { loadAutoTripSettings } from "@lib/autoTripSettings";
import { isElm327Paired, isRealBackend, onPairingChange } from "@lib/elm327";
import {
  isEngineMonitorRunning,
  retargetEngineMonitor,
  startEngineMonitor,
  stopEngineMonitor,
} from "@lib/engineMonitor";
import { useVehicle } from "@lib/vehicleContext";

const LOG_TAG = "[AutoTrip]";

export function useAutoTripController(): void {
  const { selectedVehicle } = useVehicle();
  const vehicleId = selectedVehicle?.plateNumber ?? "CBD-3742";

  // Kept in a ref so the sync effect below can read the current vehicle
  // without tearing the monitor down and rebuilding it on every change.
  const vehicleIdRef = useRef(vehicleId);
  vehicleIdRef.current = vehicleId;

  useEffect(() => {
    let cancelled = false;

    // Baseline voltages are persisted; load them before the first poll so the
    // rise-above-baseline test can fire on the very first drive of a session.
    void loadAutoTripSettings().then(() => {
      if (!cancelled) sync();
    });

    function sync(): void {
      const shouldRun =
        AppState.currentState === "active" && isElm327Paired() && isRealBackend();

      if (shouldRun) {
        startEngineMonitor({
          vehicleId: vehicleIdRef.current,
          handlers: {
            // ── The auto-recording seam. Currently observe-only. ──
            onEngineStart: () => {
              console.log(`${LOG_TAG} ENGINE START detected (observe-only — not starting a trip)`);
            },
            onEngineStop: () => {
              console.log(`${LOG_TAG} ENGINE STOP detected (observe-only — not ending a trip)`);
            },
            onAdapterLost: (sinceMs) => {
              console.log(`${LOG_TAG} adapter unreachable for ${Math.round(sinceMs / 1000)}s`);
            },
          },
        });
      } else {
        stopEngineMonitor();
      }
    }

    const unsubPairing = onPairingChange(sync);

    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") sync();
      else stopEngineMonitor(); // JS timers don't survive backgrounding
    });

    sync();

    return () => {
      cancelled = true;
      unsubPairing();
      appStateSub.remove();
      stopEngineMonitor();
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
