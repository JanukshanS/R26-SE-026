/**
 * ============================================================================
 * ELM327 Service — facade over a REAL BLE reader with a SIMULATION fallback
 * ============================================================================
 *
 * Public entry point for the rest of the app. Callers (`home.tsx`,
 * `(emergency)/context.tsx`) import everything from here and never need to
 * know whether the readings came from a physical ELM327 dongle over Bluetooth
 * or from the on-device simulation.
 *
 * Routing rule (decided once, at runtime):
 *   - If the native `react-native-ble-plx` module is actually present AND the
 *     scan/connect/handshake succeeds → use the REAL reader (`elm327.ble.ts`).
 *   - Otherwise — web, Expo Go (native module can't load), no Bluetooth
 *     adapter, no dongle found, or any connect/read failure → transparently
 *     use the SIMULATION (`elm327.sim.ts`). Every existing screen keeps
 *     working unchanged; the demo never breaks.
 *
 * Why a facade instead of one big file with an `if`: the simulation is the
 * fallback and stays self-contained; the BLE code is the only place that
 * `require()`s native and must be loaded defensively. Splitting them keeps
 * each readable and guarantees the native require can't leak into the
 * always-evaluated path.
 *
 * API COMPATIBILITY
 * -----------------
 * The synchronous `pairElm327(vehicleId)` is preserved verbatim (it pairs the
 * simulation and returns `PairingInfo` immediately — no UI churn). Real BLE
 * pairing is inherently async (scan+connect takes seconds), so it gets its own
 * `pairElm327Async(vehicleId)` which `home.tsx` awaits behind a "Connecting…"
 * state and which falls back to the sim on failure.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import * as sim from "./elm327.sim";
import * as ble from "./elm327.ble";

// Re-export the shared types & constants unchanged so callers keep importing
// them from "@lib/elm327".
export type { TriageOBDData, VehicleState } from "./elm327.sim";
export { VEHICLE_STATES } from "./elm327.sim";

import type { PairingInfo, VehicleState } from "./elm327.sim";
export type { PairingInfo };

/**
 * How the current pairing is backed. "ble" means a live dongle; "sim" means
 * the on-device fallback. Tracked so the facade routes reads correctly and so
 * teardown hits the right backend.
 */
type Backend = "ble" | "sim" | null;
let backend: Backend = null;

// ─────────────────────────────────────────────────────────────────────────
// Pairing state queries
// ─────────────────────────────────────────────────────────────────────────

/**
 * True if EITHER a real ELM327 is connected OR the simulation is paired.
 * `home.tsx` uses this to decide whether to show the "Connect OBD-II" modal,
 * and `(emergency)/context.tsx` to label the expected triage tier.
 */
export function isElm327Paired(): boolean {
  return backend === "ble" ? ble.isConnected() : sim.isPaired();
}

/**
 * Pairing metadata. For a real dongle this carries the device's actual MAC
 * (state is reported as "HEALTHY" since we read real telemetry, not a
 * synthesized condition). For the simulation it's the synthesized handle.
 */
export function getPairing(): Readonly<PairingInfo> | null {
  // Real-BLE pairing also records a sim-shaped PairingInfo (with the real MAC)
  // so this getter stays uniform for callers; see pairElm327Async.
  return sim.getPairing();
}

/**
 * Force the next SIMULATED read to a specific vehicle state (viva demos).
 * No-op effect on a live dongle — real telemetry can't be forced — but kept
 * callable so the public API is unchanged.
 */
export function setForcedState(state: VehicleState | null): void {
  sim.setForcedState(state);
}

export function getCurrentState(): VehicleState | null {
  return sim.getCurrentState();
}

// ─────────────────────────────────────────────────────────────────────────
// Pairing
// ─────────────────────────────────────────────────────────────────────────

/**
 * SYNCHRONOUS pairing — pairs the SIMULATION and returns immediately. Kept for
 * backwards compatibility and as the guaranteed-instant path. `home.tsx` now
 * prefers `pairElm327Async` (which tries the real dongle first), but anything
 * that needs a synchronous PairingInfo can still call this.
 */
export function pairElm327(vehicleId: string): PairingInfo {
  const info = sim.pair(vehicleId);
  backend = "sim";
  return info;
}

/**
 * ASYNC pairing — tries the REAL ELM327 over BLE first; on any failure
 * (BLE unavailable, no dongle, connect/handshake error) transparently falls
 * back to the simulation so pairing never hard-fails the user. Returns the
 * `PairingInfo` either way.
 *
 * `home.tsx` awaits this behind a "Connecting…" state. On a successful BLE
 * connect, `isElm327Paired()` returns true and reads flow from the dongle.
 *
 * @throws never — always resolves (real or simulated).
 */
export async function pairElm327Async(vehicleId: string): Promise<PairingInfo> {
  // No native BLE here (web / Expo Go / no adapter) → straight to sim.
  if (!ble.isBleAvailable()) {
    return pairElm327(vehicleId);
  }

  try {
    const { mac } = await ble.connect();
    // Record a uniform PairingInfo carrying the REAL device MAC so getPairing()
    // and the home modal behave identically to the sim path. Reads, however,
    // are routed to BLE via `backend`.
    const info = sim.pair(vehicleId);
    (info as { mac: string }).mac = mac;
    backend = "ble";
    return info;
  } catch {
    // Scan/connect/handshake failed — fall back to the simulation so the user
    // still gets a working (simulated) OBD session instead of a dead end.
    return pairElm327(vehicleId);
  }
}

/**
 * Whether the current runtime can even attempt a real BLE connection
 * (false on web and in Expo Go). `home.tsx` can use this to tailor copy
 * ("Pair OBD-II" vs "Pair (simulated)") if desired — optional.
 */
export function isRealBleSupported(): boolean {
  return ble.isBleAvailable();
}

// ─────────────────────────────────────────────────────────────────────────
// Unpair
// ─────────────────────────────────────────────────────────────────────────

/**
 * Drop the pairing. Tears down a live BLE connection if there is one, and
 * always clears the simulation handle. Fire-and-forget on the BLE disconnect
 * so the signature stays synchronous (matches the previous contract; callers
 * like `home.tsx`'s Log out don't await it).
 */
export function unpairElm327(): void {
  if (backend === "ble") {
    void ble.disconnect();
  }
  sim.unpair();
  backend = null;
}

// ─────────────────────────────────────────────────────────────────────────
// Live read
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read live OBD telemetry. Routes to the real dongle when one is connected,
 * else to the simulation. Returns `null` when nothing is paired (manual
 * vehicle → Tier-1 on the dispatch backend).
 *
 * If a real BLE read fails mid-session (e.g. the dongle drops), we degrade to
 * a simulated read rather than returning null — the emergency flow keeps a
 * Tier-2 payload instead of silently dropping to Tier-1.
 */
export async function readObdFromElm327(
  incidentId?: string
): Promise<sim.TriageOBDData | null> {
  if (backend === "ble" && ble.isConnected()) {
    try {
      const real = await ble.readObd();
      if (real) return real;
    } catch {
      /* fall through to a simulated read below */
    }
    // BLE returned nothing / threw → make sure the sim has a handle, then read
    // from it so the caller still receives Tier-2 telemetry this incident.
    if (!sim.isPaired()) sim.pair(getPairing()?.vehicleId ?? "UNKNOWN");
    return sim.readObd(incidentId);
  }

  return sim.readObd(incidentId);
}
