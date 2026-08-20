/**
 * ============================================================================
 * ELM327 Service — facade over REAL Bluetooth readers with a SIMULATION fallback
 * ============================================================================
 *
 * Public entry point for the rest of the app. Callers (`home.tsx`,
 * `(emergency)/context.tsx`, `tripRecorder.ts`) import everything from here
 * and never need to know whether readings came from a physical ELM327 over
 * BLE, over classic Bluetooth, or from the on-device simulation.
 *
 * Routing rule (decided once per pairing attempt, at runtime):
 *   1. If the native `react-native-ble-plx` module is present AND a BLE
 *      ELM327-looking device is found and connects → use BLE (`elm327.ble.ts`).
 *   2. Otherwise, if `react-native-bluetooth-classic` is present AND an
 *      already-bonded ELM327-looking device connects → use classic Bluetooth
 *      (`elm327.classic.ts`). Most cheap "Bluetooth OBD2" dongles are
 *      actually classic (SPP), not BLE — a PIN prompt during Android pairing
 *      is the tell. A BLE scan can never see these, so without this fallback
 *      they'd silently and permanently read as simulated.
 *   3. Otherwise — web, Expo Go (native modules can't load), no adapter, no
 *      dongle found, or any connect/read failure → transparently use the
 *      SIMULATION (`elm327.sim.ts`). Every existing screen keeps working
 *      unchanged; the demo never breaks.
 *
 * Why a facade instead of one big file with an `if`: the simulation is the
 * fallback and stays self-contained; the BLE and classic modules are the only
 * places that `require()` native code and must be loaded defensively.
 * Splitting them keeps each readable and guarantees a native require can't
 * leak into the always-evaluated path.
 *
 * API COMPATIBILITY
 * -----------------
 * The synchronous `pairElm327(vehicleId)` is preserved verbatim (it pairs the
 * simulation and returns `PairingInfo` immediately — no UI churn). Real
 * pairing (BLE or classic) is inherently async (scan/lookup + connect takes
 * seconds), so it gets its own `pairElm327Async(vehicleId)` which `home.tsx`
 * awaits behind a "Connecting…" state and which falls back to the sim on
 * failure.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import * as sim from "./elm327.sim";
import * as ble from "./elm327.ble";
import * as classic from "./elm327.classic";

// Re-export the shared types & constants unchanged so callers keep importing
// them from "@lib/elm327".
export type { TriageOBDData, VehicleState } from "./elm327.sim";
export { VEHICLE_STATES } from "./elm327.sim";

import type { PairingInfo, VehicleState } from "./elm327.sim";
export type { PairingInfo };

/**
 * How the current pairing is backed. "ble"/"classic" mean a live dongle over
 * that transport; "sim" means the on-device fallback. Tracked so the facade
 * routes reads correctly and so teardown hits the right backend.
 */
type Backend = "ble" | "classic" | "sim" | null;
let backend: Backend = null;

/**
 * True only when a PHYSICAL dongle is on the other end. The engine monitor
 * gates on this: the simulator's `synthesizeObd` always models a running
 * engine (RPM floored at 700, voltage ~13.9V — see `tripRecorder.ts`), so
 * letting simulated data reach engine-state detection would report "running"
 * forever on a parked car.
 */
export function isRealBackend(): boolean {
  return backend === "ble" || backend === "classic";
}

// ─────────────────────────────────────────────────────────────────────────
// Pairing-change notification
// ─────────────────────────────────────────────────────────────────────────
// Nothing could previously observe pair/unpair without polling
// `isElm327Paired()`. The engine monitor needs to start and stop in step with
// the connection, so the facade now announces the transitions.

const pairingListeners = new Set<() => void>();

export function onPairingChange(cb: () => void): () => void {
  pairingListeners.add(cb);
  return () => pairingListeners.delete(cb);
}

function notifyPairingChange(): void {
  pairingListeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.log(`[ELM327:Facade] pairing listener threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Pairing state queries
// ─────────────────────────────────────────────────────────────────────────

/**
 * True if EITHER a real ELM327 is connected (either transport) OR the
 * simulation is paired. `home.tsx` uses this to decide whether to show the
 * "Connect OBD-II" modal, and `(emergency)/context.tsx` to label the
 * expected triage tier.
 */
export function isElm327Paired(): boolean {
  if (backend === "ble") return ble.isConnected();
  if (backend === "classic") return classic.isConnected();
  return sim.isPaired();
}

/**
 * Pairing metadata. For a real dongle this carries the device's actual MAC
 * (state is reported as "HEALTHY" since we read real telemetry, not a
 * synthesized condition). For the simulation it's the synthesized handle.
 */
export function getPairing(): Readonly<PairingInfo> | null {
  // Real pairing (either transport) also records a sim-shaped PairingInfo
  // (with the real MAC/source) so this getter stays uniform for callers;
  // see pairElm327Async.
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
 * prefers `pairElm327Async` (which tries the real transports first), but
 * anything that needs a synchronous PairingInfo can still call this.
 */
export function pairElm327(vehicleId: string): PairingInfo {
  const info = sim.pair(vehicleId);
  backend = "sim";
  notifyPairingChange();
  return info;
}

/**
 * ASYNC pairing — tries BLE first, then classic Bluetooth, then falls back
 * to the simulation so pairing never hard-fails the user. Returns the
 * `PairingInfo` either way.
 *
 * `home.tsx` awaits this behind a "Connecting…" state. On a successful real
 * connect, `isElm327Paired()` returns true and reads flow from the dongle.
 *
 * @throws never — always resolves (real or simulated).
 */
export async function pairElm327Async(vehicleId: string): Promise<PairingInfo> {
  console.log(`[ELM327:Facade] pairElm327Async — bleAvailable=${ble.isBleAvailable()} classicAvailable=${classic.isClassicAvailable()}`);

  if (ble.isBleAvailable()) {
    try {
      const { mac, name } = await ble.connect();
      console.log(`[ELM327:Facade] BLE connected: ${name ?? mac}`);
      return recordRealPairing(vehicleId, "ble", mac, name);
    } catch (e) {
      console.log(`[ELM327:Facade] BLE connect failed, trying classic next: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (classic.isClassicAvailable()) {
    try {
      const { mac, name } = await classic.connect();
      console.log(`[ELM327:Facade] Classic connected: ${name ?? mac}`);
      return recordRealPairing(vehicleId, "classic", mac, name);
    } catch (e) {
      console.log(`[ELM327:Facade] Classic connect failed, falling back to simulation: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[ELM327:Facade] Falling back to simulation.`);
  return pairElm327(vehicleId);
}

/**
 * Record a uniform PairingInfo carrying the REAL device MAC/name/source so
 * getPairing() and the home modal behave identically regardless of which
 * transport actually connected. Reads are routed by `backend`.
 */
function recordRealPairing(
  vehicleId: string,
  via: "ble" | "classic",
  mac: string,
  name: string | null
): PairingInfo {
  const info = sim.pair(vehicleId);
  (info as { mac: string }).mac = mac;
  (info as { source: string }).source = via;
  (info as { deviceName?: string }).deviceName = name ?? undefined;
  backend = via;
  notifyPairingChange();
  return info;
}

/**
 * Whether the current runtime can even attempt a real connection (BLE or
 * classic) — false on web and in Expo Go. `home.tsx` can use this to tailor
 * copy ("Pair OBD-II" vs "Pair (simulated)") if desired — optional.
 */
export function isRealBleSupported(): boolean {
  return ble.isBleAvailable() || classic.isClassicAvailable();
}

// ─────────────────────────────────────────────────────────────────────────
// Unpair
// ─────────────────────────────────────────────────────────────────────────

/**
 * Drop the pairing. Tears down a live connection (either transport) if
 * there is one, and always clears the simulation handle. Fire-and-forget on
 * the real disconnect so the signature stays synchronous (matches the
 * previous contract; callers like `home.tsx`'s Log out don't await it).
 */
export function unpairElm327(): void {
  if (backend === "ble") void ble.disconnect();
  if (backend === "classic") void classic.disconnect();
  sim.unpair();
  backend = null;
  notifyPairingChange();
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
 *
 * NOTE: classic Bluetooth doesn't implement this triage-shaped read yet
 * (only the trip-recorder's `readRawObdPids` below) — a classic-paired
 * session reads simulated data here until that's added.
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

// ─────────────────────────────────────────────────────────────────────────
// Raw PID read (predictive-maintenance trip recorder)
// ─────────────────────────────────────────────────────────────────────────

export type { RawObdPids } from "./elm327.ble";

/**
 * Read raw Mode 01 PIDs for trip logging (`tripRecorder.ts`) — a different
 * shape from `readObdFromElm327`'s triage data. Returns null when there's no
 * live dongle connected (either transport); the trip recorder falls back to
 * its own synthetic generator per-field in that case, same pattern as the
 * triage path falling back to `elm327.sim.ts`.
 */
export async function readRawObdPids(): Promise<ble.RawObdPids | null> {
  try {
    if (backend === "ble" && ble.isConnected()) return await ble.readObdRaw();
    if (backend === "classic" && classic.isConnected()) return await classic.readObdRaw();
  } catch {
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Engine-state signals (engineMonitor.ts)
// ─────────────────────────────────────────────────────────────────────────

export type { EngineSignals } from "./elm327.protocol";

/**
 * Poll engine-state signals from a REAL dongle.
 *
 * The key property is that ATRV reads OBD pin 16, which is permanently live
 * and NOT switched by the ignition — so this returns a usable voltage with the
 * car completely off, which is exactly the case where every Mode 01 PID query
 * comes back empty because the ECU is asleep.
 *
 * Returns null on the simulation backend BY DESIGN — see `isRealBackend()`.
 */
export async function readEngineSignals(
  opts?: { probeRpm?: boolean }
): Promise<import("./elm327.protocol").EngineSignals | null> {
  const probeRpm = opts?.probeRpm ?? false;
  try {
    if (backend === "ble" && ble.isConnected()) return await ble.readEngineSignals({ probeRpm });
    if (backend === "classic" && classic.isConnected()) return await classic.readEngineSignals({ probeRpm });
  } catch {
    // A throw this far out means the transport itself broke, which is the
    // adapter-unreachable case — report it as such rather than as "no link".
    return { voltage: null, rpm: null, adapterAlive: false };
  }
  return null;
}
