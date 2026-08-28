import { scanDtcs, type DtcScan } from "@lib/elm327.dtc";
/**
 * ============================================================================
 * ELM327 Service — REAL classic Bluetooth (SPP/RFCOMM) OBD-II reader
 * ============================================================================
 *
 * Most cheap "ELM327 Bluetooth OBD2" dongles are actually classic Bluetooth
 * (SPP serial), not BLE — a strong tell is that pairing them in Android's
 * system Bluetooth settings asks for a PIN (BLE devices generally don't).
 * `elm327.ble.ts` can never see these: a BLE scan does not discover classic
 * Bluetooth peripherals at all, so a classic-only dongle would silently and
 * permanently fail BLE connect and fall back to the simulator, no matter how
 * correct the rest of the app is.
 *
 * This module talks to that same class of dongle over
 * `react-native-bluetooth-classic` (Android's BluetoothSocket/RFCOMM). The
 * AT handshake, PID queries, and hex parsing are shared with the BLE
 * transport via `elm327.protocol.ts` — only the transport (open a classic
 * socket, write/read bytes) differs.
 *
 * Classic Bluetooth's pairing model is also different from BLE: the device
 * must already be bonded via Android's system Bluetooth settings (that's
 * what asked for the PIN) — this module connects to an already-bonded
 * device, it does not do its own pairing UI.
 *
 * WHY THIS MUST BE LOADED DEFENSIVELY
 * -----------------------------------
 * Same reasoning as `elm327.ble.ts`: `react-native-bluetooth-classic` is a
 * native module, absent on web and in Expo Go. A top-level import would
 * crash both. We `require()` it lazily and probe once; any failure falls
 * through to the facade's next option.
 *
 * WHAT A GENERIC OBD-II PORT CAN AND CANNOT GIVE US
 * -------------------------------------------------
 * Same SAE J1979 Mode 01 PID limitations as the BLE transport — see that
 * file's header for the full explanation.
 */

import { PermissionsAndroid, Platform } from "react-native";
import type { TriageOBDData } from "./elm327.sim";
import {
  discoverSupportedPids,
  queryPid as protocolQueryPid,
  readEngineSignalsGeneric,
  readObdRawGeneric,
  runInitHandshake,
  sanitizeForLog,
  withObdLock,
  type EngineSignals,
  type RawObdPids,
} from "./elm327.protocol";

// ─────────────────────────────────────────────────────────────────────────
// Minimal structural types for the dynamically-required native module
// ─────────────────────────────────────────────────────────────────────────
//
// Same defensive pattern as elm327.ble.ts — no top-level import of the
// native package, just enough of its shape to satisfy the `require()`d
// object at runtime.

interface ClassicReadEvent {
  data: string;
}

interface ClassicEventSubscription {
  remove(): void;
}

interface ClassicDevice {
  name: string | null;
  address: string;
  type?: string; // 'CLASSIC' | 'LOW_ENERGY' | 'DUAL' | 'UNKNOWN'
  connect(options?: Record<string, unknown>): Promise<boolean>;
  disconnect(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  write(data: string, encoding?: string): Promise<boolean>;
  onDataReceived(listener: (event: ClassicReadEvent) => void): ClassicEventSubscription;
}

interface ClassicModuleLike {
  isBluetoothEnabled(): Promise<boolean>;
  getBondedDevices(): Promise<ClassicDevice[]>;
}

const LOG_TAG = "[ELM327:Classic]";

let _module: ClassicModuleLike | null = null;
let _probed = false;
let _available = false;

/**
 * Returns the shared module instance, or null if classic Bluetooth is
 * unavailable on this runtime. Never throws; probes exactly once.
 *   - Web / iOS → unavailable (no classic BT support here; iOS classic BT
 *     needs MFi-certified hardware via External Accessory, not viable for a
 *     generic dongle).
 *   - Expo Go → `require` resolves a stub that throws on first native call;
 *     caught below and marked unavailable.
 *   - Dev/standalone Android build → real module.
 */
function getModule(): ClassicModuleLike | null {
  if (_probed) return _module;
  _probed = true;

  if (Platform.OS !== "android") {
    console.log(`${LOG_TAG} unavailable: Platform.OS is "${Platform.OS}", classic BT is Android-only here`);
    _available = false;
    return null;
  }

  try {
    const mod = require("react-native-bluetooth-classic") as
      | { default?: ClassicModuleLike }
      | ClassicModuleLike;
    console.log(`${LOG_TAG} require() ok — module keys: [${Object.keys(mod as object).join(",")}]`);
    const instance = ((mod as { default?: ClassicModuleLike }).default ?? mod) as ClassicModuleLike;
    if (!instance || typeof instance.getBondedDevices !== "function") {
      console.log(`${LOG_TAG} unavailable: resolved instance has no getBondedDevices — instance keys: [${instance ? Object.keys(instance as object).join(",") : "null"}]`);
      _available = false;
      return null;
    }
    _module = instance;
    _available = true;
    console.log(`${LOG_TAG} module available`);
    return _module;
  } catch (e) {
    console.log(`${LOG_TAG} unavailable: require() threw — ${e instanceof Error ? e.message : String(e)}`);
    _available = false;
    _module = null;
    return null;
  }
}

export function isClassicAvailable(): boolean {
  getModule();
  return _available;
}

// ─────────────────────────────────────────────────────────────────────────
// Runtime permissions (Android 12+ / API 31+)
// ─────────────────────────────────────────────────────────────────────────
//
// BLUETOOTH_CONNECT/BLUETOOTH_SCAN are declared in the manifest (ours +
// the library's own, merged at build time) but on API 31+ that's not
// enough — Android also requires an explicit runtime grant, same as
// camera/location. Without this, every native Bluetooth call throws
// "Need android.permission.BLUETOOTH_CONNECT permission" regardless of
// how correct the rest of the connect logic is.

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < 31) return true; // manifest-only is enough pre-12

  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    const connectGranted = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
    console.log(`${LOG_TAG} runtime permissions -> ${JSON.stringify(results)}`);
    return connectGranted;
  } catch (e) {
    console.log(`${LOG_TAG} permission request threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Device matching (same name heuristics as the BLE transport)
// ─────────────────────────────────────────────────────────────────────────

function looksLikeElm327(name: string | null): boolean {
  const n = (name ?? "").toUpperCase();
  if (!n) return true; // unnamed — still worth trying, it's the only bonded option
  return (
    n.includes("OBD") ||
    n.includes("ELM") ||
    n.includes("VLINK") ||
    n.includes("VEEPEAK") ||
    n.includes("VIECAR") ||
    n.includes("KONNWEI") ||
    n.includes("ICAR")
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Timeout helper (same pattern as elm327.ble.ts)
// ─────────────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor(label: string) {
    super(`Classic BT timeout: ${label}`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new TimeoutError(label)), ms);
    work.then(
      (v) => { clearTimeout(handle); resolve(v); },
      (e) => { clearTimeout(handle); reject(e); }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Connection handle — one live ELM327 session
// ─────────────────────────────────────────────────────────────────────────

interface ClassicLink {
  device: ClassicDevice;
  sub: ClassicEventSubscription;
  /** Resolver waiting for the next delimited (`>`-terminated) response. */
  waiter: ((data: string) => void) | null;
  supportedPids: Set<number> | null;
}

let link: ClassicLink | null = null;

export function isConnected(): boolean {
  return link !== null;
}

const CONNECT_TIMEOUT_MS = 10_000;
const PROMPT_TIMEOUT_MS  = 4_000;

/**
 * Full connect path: find an already-bonded ELM327-looking device → open an
 * RFCOMM socket (delimited on `>`, matching the ELM327 prompt exactly, so
 * each `onDataReceived` event is one complete response) → run the AT init
 * handshake → discover supported PIDs. On any failure we clean up and throw
 * so the facade can fall back further (to the simulation).
 */
export async function connect(): Promise<{ mac: string; name: string | null }> {
  console.log(`${LOG_TAG} connect() starting...`);
  const mod = getModule();
  if (!mod) throw new Error("Classic Bluetooth is not available on this device.");

  const permitted = await ensurePermissions();
  console.log(`${LOG_TAG} runtime Bluetooth permission granted -> ${permitted}`);
  if (!permitted) throw new Error("Bluetooth permission was denied.");

  const enabled = await mod.isBluetoothEnabled().catch((e) => {
    console.log(`${LOG_TAG} isBluetoothEnabled() threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  });
  console.log(`${LOG_TAG} isBluetoothEnabled() -> ${enabled}`);
  if (!enabled) throw new Error("Bluetooth is off. Turn Bluetooth on and try again.");

  let bonded: ClassicDevice[];
  try {
    bonded = await withTimeout(mod.getBondedDevices(), 8_000, "getBondedDevices");
  } catch (e) {
    console.log(`${LOG_TAG} getBondedDevices() failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  console.log(
    `${LOG_TAG} getBondedDevices() -> ${bonded.length} device(s): ` +
    `[${bonded.map((d) => `"${d.name}" (${d.address}, type=${d.type ?? "?"})`).join(", ")}]`
  );

  const candidate = bonded.find((d) => looksLikeElm327(d.name));
  if (!candidate) {
    throw new Error(
      "No paired ELM327-looking device found. Pair it in Android's Bluetooth settings first (classic dongles need a PIN, usually 1234 or 0000)."
    );
  }
  console.log(`${LOG_TAG} candidate: "${candidate.name}" (${candidate.address}) — connecting...`);

  try {
    await withTimeout(
      candidate.connect({ delimiter: ">", secureSocket: true }),
      CONNECT_TIMEOUT_MS,
      "connect"
    );
  } catch (e) {
    console.log(`${LOG_TAG} candidate.connect() failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  console.log(`${LOG_TAG} socket connected`);

  const newLink: ClassicLink = {
    device: candidate,
    sub: undefined as unknown as ClassicEventSubscription, // set just below
    waiter: null,
    supportedPids: null,
  };

  // With `delimiter: ">"` the native side already buffers until the next
  // `>` and hands us one complete response per event (delimiter stripped) —
  // no manual chunk accumulation needed, unlike the BLE transport.
  newLink.sub = candidate.onDataReceived((event) => {
    const w = newLink.waiter;
    newLink.waiter = null;
    if (w) w(event.data);
  });

  link = newLink;

  try {
    await runInitHandshake(sendCommand, LOG_TAG);
  } catch (e) {
    await disconnect();
    throw e;
  }

  try {
    newLink.supportedPids = await discoverSupportedPids(sendCommand, LOG_TAG);
    const list = [...newLink.supportedPids].sort((a, b) => a - b).map((p) => "0x" + p.toString(16).padStart(2, "0"));
    console.log(`${LOG_TAG} PID support discovered: [${list.join(",")}]`);
  } catch (e) {
    console.log(`${LOG_TAG} PID support discovery failed (will try every target PID directly): ${e instanceof Error ? e.message : String(e)}`);
    newLink.supportedPids = null;
  }

  return { mac: candidate.address, name: candidate.name };
}

// ─────────────────────────────────────────────────────────────────────────
// ELM327 command transport
// ─────────────────────────────────────────────────────────────────────────

function sendCommand(cmd: string): Promise<string> {
  const l = link;
  if (!l) return Promise.reject(new Error("Not connected."));

  console.log(`${LOG_TAG} TX ${cmd}`);
  const wait = new Promise<string>((resolve) => {
    l.waiter = resolve;
  });

  const write = l.device.write(`${cmd}\r`);

  return withTimeout(
    write.then(() => wait),
    PROMPT_TIMEOUT_MS,
    `cmd ${cmd}`
  ).then((resp) => {
    console.log(`${LOG_TAG} RX ${cmd} -> "${sanitizeForLog(resp)}"`);
    return resp;
  }).catch((e) => {
    if (l.waiter) l.waiter = null;
    console.log(`${LOG_TAG} TIMEOUT/ERROR ${cmd} -> ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  });
}

/** Query one PID via the shared protocol logic, tagged for classic in the logs. */
function queryPid(pid: string): Promise<number[] | null> {
  return protocolQueryPid(sendCommand, pid, LOG_TAG);
}

/**
 * Read all the PIDs we can map to TriageOBDData. Returns null if the link is
 * gone. Each PID is best-effort: a missing one just leaves its field
 * `undefined`. Mirrors `elm327.ble.ts`'s `readObd()` exactly — same PIDs,
 * same field mapping — since the underlying AT/PID protocol and the fields a
 * generic OBD-II port can expose don't depend on the transport.
 */
export async function readObd(): Promise<TriageOBDData | null> {
  if (!link) return null;
  return withObdLock("classic.readObd", readObdUnlocked);
}

async function readObdUnlocked(): Promise<TriageOBDData | null> {
  if (!link) return null;

  const out: Partial<TriageOBDData> & { available: true } = { available: true };

  // 010C — Engine RPM = ((A*256)+B)/4
  const rpm = await queryPid("010C");
  if (rpm && rpm.length >= 2) {
    out.engine_rpm = Number((((rpm[0] * 256) + rpm[1]) / 4).toFixed(0));
  }

  // 0105 — Engine coolant temperature = A - 40  (°C)
  const coolant = await queryPid("0105");
  if (coolant && coolant.length >= 1) {
    out.coolant_temp_c = coolant[0] - 40;
  }

  // 0104 — Calculated engine load = A * 100 / 255  (%)
  const load = await queryPid("0104");
  if (load && load.length >= 1) {
    out.engine_load_percent = Number(((load[0] * 100) / 255).toFixed(1));
  }

  // 012F — Fuel tank level input = A * 100 / 255  (%)
  const fuel = await queryPid("012F");
  if (fuel && fuel.length >= 1) {
    out.fuel_level_percent = Number(((fuel[0] * 100) / 255).toFixed(1));
  }

  // 0142 — Control module voltage = ((A*256)+B)/1000  (V). The closest
  // standard PID to "battery voltage" — it's the ECU supply rail, which
  // tracks battery voltage well enough for the Tier-2 tree.
  const ctrlV = await queryPid("0142");
  if (ctrlV && ctrlV.length >= 2) {
    out.battery_voltage_v = Number((((ctrlV[0] * 256) + ctrlV[1]) / 1000).toFixed(2));
  }

  // 0146 — Ambient air temperature = A - 40  (°C)
  const ambient = await queryPid("0146");
  if (ambient && ambient.length >= 1) {
    out.ambient_temp_c = ambient[0] - 40;
  }

  // 010F — Intake air temperature = A - 40  (°C), used as a proxy for
  // `engine_temp_c` (no standard "engine block temp" PID exists).
  const intake = await queryPid("010F");
  if (intake && intake.length >= 1) {
    out.engine_temp_c = intake[0] - 40;
  }

  // NOTE — fields left `undefined` on purpose because a generic OBD-II port
  // does NOT expose them (need manufacturer-specific UDS or aftermarket
  // sensors): battery_temp_c, battery_charge_percent, battery_health_percent,
  // alternator_output_v, oil_pressure_psi, brake_fluid_level_psi,
  // brake_pad_wear_mm, brake_temp_c.

  return out as TriageOBDData;
}

/**
 * Read the Mode 01 PIDs the trip recorder needs. Returns null if there's no
 * live link at all; individual PIDs that don't answer are simply omitted.
 */
export async function readObdRaw(): Promise<RawObdPids | null> {
  const l = link;
  if (!l) {
    console.log(`${LOG_TAG} readObdRaw: no live link — skipping (caller falls back to synthetic)`);
    return null;
  }
  return withObdLock("classic.readObdRaw", () => readObdRawGeneric(sendCommand, l.supportedPids, LOG_TAG));
}

/**
 * Read engine-state signals (ATRV voltage, optionally RPM) for the engine
 * monitor. Returns null only when there's no live link at all — an adapter
 * that's reachable but says nothing useful still reports `adapterAlive`.
 */
export async function readEngineSignals(opts: { probeRpm: boolean }): Promise<EngineSignals | null> {
  if (!link) return null;
  return withObdLock("classic.readEngineSignals", () => readEngineSignalsGeneric(sendCommand, opts, LOG_TAG));
}

// ─────────────────────────────────────────────────────────────────────────
// Teardown
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read fault codes over the classic link.
 *
 * Uses the same command lock as the PID reads: the ELM327 has a single-slot
 * waiter, so a mode 03 issued while a PID query is outstanding would collide
 * and desynchronise both replies.
 */
export async function scanDtcCodes(): Promise<DtcScan> {
  const l = link;
  if (!l?.device) return { codes: [], readOk: false };
  return withObdLock("classic.scanDtcs", () => scanDtcs(sendCommand, LOG_TAG));
}


export async function disconnect(): Promise<void> {
  const l = link;
  link = null;
  if (!l) return;
  try { l.sub.remove(); } catch { /* ignore */ }
  try { await l.device.disconnect(); } catch { /* ignore */ }
}

export type { EngineSignals, RawObdPids };
