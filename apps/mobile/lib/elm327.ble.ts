/**
 * ============================================================================
 * ELM327 Service — REAL Bluetooth (BLE) OBD-II reader
 * ============================================================================
 *
 * Talks to a physical ELM327 BLE dongle over `react-native-ble-plx`. The AT
 * handshake, Mode 01 PID queries, and hex parsing are shared with the classic
 * Bluetooth transport (`elm327.classic.ts`) via `elm327.protocol.ts` — this
 * file only implements the BLE-specific transport (scan, connect, GATT
 * write/notify) and hands it a `sendCommand` function.
 *
 * WHY THIS MUST BE LOADED DEFENSIVELY
 * -----------------------------------
 * `react-native-ble-plx` is a NATIVE module. It is NOT present in Expo Go and
 * not on web. A top-level `import { BleManager } from "react-native-ble-plx"`
 * would make the bundler pull native code into the always-evaluated module
 * graph and crash the running Expo Go demo + the web build on the very first
 * import of this file. So we `require()` it lazily inside a try/catch and
 * construct the manager defensively; any failure (module missing, constructor
 * throws, adapter off) flips `bleAvailable` to false and the facade falls
 * back to classic Bluetooth, then the simulation. Real BLE only comes alive
 * in a dev/standalone build where the native module is linked.
 *
 * WHAT A GENERIC OBD-II PORT CAN AND CANNOT GIVE US
 * -------------------------------------------------
 * Only the Mode 01 PIDs below are part of the SAE J1979 standard and readable
 * from any car's OBD-II port via an ELM327. The richer fields the simulation
 * fabricates (battery temp/charge/health, alternator output, oil pressure,
 * the three brake metrics) are NOT standard OBD-II — they need a
 * manufacturer-specific UDS request or aftermarket sensors that a $10 ELM327
 * clone does not expose. We therefore leave those fields `undefined`. That is
 * deliberate and correct: the dispatch backend's `toTreeInput` guards every
 * field with `!== undefined`, so omitting them simply means the Tier-2 ML
 * tree decides on the PIDs we *do* have, instead of on fabricated numbers.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { Platform } from "react-native";
import type { TriageOBDData, VehicleState } from "./elm327.sim";
import {
  discoverSupportedPids,
  queryPid as protocolQueryPid,
  readObdRawGeneric,
  runInitHandshake,
  sanitizeForLog,
  type RawObdPids,
} from "./elm327.protocol";

// ─────────────────────────────────────────────────────────────────────────
// Minimal structural types for the dynamically-required native module
// ─────────────────────────────────────────────────────────────────────────
//
// We intentionally do NOT `import` from "react-native-ble-plx" at the top
// level (that would eagerly bundle native into the always-loaded graph — see
// the file header). Instead we model just the slice of the API we use. These
// mirror the real signatures from the package's d.ts closely enough for the
// `require()`d object to satisfy them at runtime.

type BleErr = Error | null;

interface BleCharacteristic {
  uuid: string;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  isNotifiable: boolean;
  value: string | null; // base64
}

interface BleService {
  uuid: string;
  characteristics(): Promise<BleCharacteristic[]>;
}

interface BleSubscription {
  remove(): void;
}

interface BleDevice {
  id: string;
  name: string | null;
  discoverAllServicesAndCharacteristics(): Promise<BleDevice>;
  services(): Promise<BleService[]>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: BleErr, characteristic: BleCharacteristic | null) => void
  ): BleSubscription;
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<BleCharacteristic>;
  writeCharacteristicWithoutResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<BleCharacteristic>;
  cancelConnection(): Promise<BleDevice>;
}

interface BleManagerLike {
  state(): Promise<string>;
  startDeviceScan(
    uuids: string[] | null,
    options: unknown | null,
    listener: (error: BleErr, device: BleDevice | null) => void
  ): void;
  stopDeviceScan(): void;
  connectToDevice(id: string, options?: unknown): Promise<BleDevice>;
  destroy(): void;
}

interface BleManagerCtor {
  new (): BleManagerLike;
}

// ─────────────────────────────────────────────────────────────────────────
// Lazy, defensive native-module acquisition
// ─────────────────────────────────────────────────────────────────────────

let _manager: BleManagerLike | null = null;
let _probed = false;
let _available = false;

/**
 * Returns the shared BleManager, or null if BLE is unavailable on this
 * runtime. Never throws. We probe exactly once and cache the verdict.
 *   - Web → unavailable (no native BLE).
 *   - Expo Go → `require` resolves a stub whose `BleManager` constructor
 *     throws "BleManager was constructed but the native module ... could not
 *     be found"; we catch it and mark unavailable.
 *   - Dev/standalone build → real manager.
 */
function getManager(): BleManagerLike | null {
  if (_probed) return _manager;
  _probed = true;

  if (Platform.OS === "web") {
    _available = false;
    return null;
  }

  try {
    // Indirect require so Metro doesn't hoist this into eager evaluation and
    // so a missing module is a catchable runtime error, not a load crash.
    const mod = require("react-native-ble-plx") as { BleManager?: BleManagerCtor };
    const Ctor = mod?.BleManager;
    if (typeof Ctor !== "function") {
      _available = false;
      return null;
    }
    _manager = new Ctor();
    _available = true;
    return _manager;
  } catch {
    // Native module absent (Expo Go) or constructor failed — fall back to sim.
    _available = false;
    _manager = null;
    return null;
  }
}

/**
 * Cheap synchronous-ish availability check for the facade. Triggers the
 * one-time probe. Returns false on web/Expo Go/no-adapter so callers
 * transparently use the simulation instead.
 */
export function isBleAvailable(): boolean {
  getManager();
  return _available;
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate serial-over-GATT service/characteristic UUIDs
// ─────────────────────────────────────────────────────────────────────────
//
// Cheap ELM327 BLE clones don't agree on UUIDs — they expose a Nordic-UART-
// like "serial port" service under one of a few well-known IDs. We never
// hardcode a single one: we discover the device's services and pick the first
// candidate that has BOTH a writable and a notifiable characteristic. The
// list below is just the priority order for probing; if none match we fall
// back to scanning *every* service for a writable+notifiable pair.
//
// 128-bit forms of the 16-bit IDs (Bluetooth base UUID 0000xxxx-0000-1000-
// 8000-00805F9B34FB):
const CANDIDATE_SERVICES: string[] = [
  "0000ffe0-0000-1000-8000-00805f9b34fb", // most common clone (HM-10 style)
  "0000fff0-0000-1000-8000-00805f9b34fb", // alt clone family
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART Service (NUS)
];

// ─────────────────────────────────────────────────────────────────────────
// Hermes-safe timeout helper (no AbortSignal.timeout on Hermes)
// ─────────────────────────────────────────────────────────────────────────
//
// `react-native-ble-plx` is promise-based (not fetch), so the AbortController
// pattern from authApi/dispatchApi doesn't map 1:1; the equivalent is a manual
// setTimeout racing the work. Same intent: never let a BLE call hang forever.
class TimeoutError extends Error {
  constructor(label: string) {
    super(`BLE timeout: ${label}`);
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
// Base64 <-> ASCII (Hermes has no global Buffer/atob/btoa we can rely on)
// ─────────────────────────────────────────────────────────────────────────
//
// ELM327 framing is plain ASCII ("010C\r", responses like "41 0C 1A F8\r>"),
// so a tiny self-contained base64 codec is all we need — no extra dependency.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function asciiToBase64(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i) & 0xff;
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? "=" : B64[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

function base64ToAscii(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = B64.indexOf(clean[i]);
    const e1 = B64.indexOf(clean[i + 1]);
    const e2 = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const e3 = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out += String.fromCharCode((e0 << 2) | (e1 >> 4));
    if (e2 !== -1) out += String.fromCharCode(((e1 & 15) << 4) | (e2 >> 2));
    if (e3 !== -1) out += String.fromCharCode(((e2 & 3) << 6) | e3);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Connection handle — one live ELM327 session
// ─────────────────────────────────────────────────────────────────────────

interface BleLink {
  device:     BleDevice;
  serviceId:  string;
  charId:     string;       // the writable+notifiable serial characteristic
  writeWithResponse: boolean;
  sub:        BleSubscription;
  /** Accumulates ASCII notification chunks until a `>` prompt arrives. */
  rxBuffer:   string;
  /** Resolver waiting for the next `>`-terminated response, if any. */
  waiter:     ((data: string) => void) | null;
  /**
   * Mode 01 PIDs (decimal) this ECU actually answers, from querying 0100/0140
   * right after connect. `null` means discovery itself failed (e.g. adapter
   * didn't answer either support query) — in that case we fall back to
   * trying every target PID directly rather than skipping all of them.
   */
  supportedPids: Set<number> | null;
}

let link: BleLink | null = null;

/** True once a real ELM327 is connected AND its init handshake completed. */
export function isConnected(): boolean {
  return link !== null;
}

// ─────────────────────────────────────────────────────────────────────────
// Scan + connect + discover
// ─────────────────────────────────────────────────────────────────────────

const SCAN_TIMEOUT_MS    = 12_000; // time to find any ELM327-looking device
const CONNECT_TIMEOUT_MS = 10_000;
const PROMPT_TIMEOUT_MS  = 4_000;  // per AT/PID command, wait for `>`
const LOG_TAG = "[ELM327:BLE]";

/**
 * An ELM327 advertises under a handful of names ("OBDII", "OBD II", "Vlink",
 * "VEEPEAK", "IOS-Vlink", "OBDBLE", "V-LINK", ...). We match loosely on name,
 * but ALSO accept any device exposing one of the candidate serial services —
 * because many clones advertise no useful name at all. To keep scanning cheap
 * and robust we accept on name OR on advertised service UUID.
 */
function looksLikeElm327(device: BleDevice): boolean {
  const name = (device.name ?? "").toUpperCase();
  if (!name) return true; // unnamed — let service discovery confirm/deny later
  return (
    name.includes("OBD") ||
    name.includes("ELM") ||
    name.includes("VLINK") ||
    name.includes("VEEPEAK") ||
    name.includes("VIECAR") ||
    name.includes("KONNWEI") ||
    name.includes("ICAR")
  );
}

/** Scan for the first ELM327-looking peripheral. Resolves with the device. */
function scanForDevice(manager: BleManagerLike): Promise<BleDevice> {
  return new Promise<BleDevice>((resolve, reject) => {
    let settled = false;
    const handle = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { manager.stopDeviceScan(); } catch { /* ignore */ }
      reject(new Error("No ELM327 device found. Make sure the dongle is plugged in and powered."));
    }, SCAN_TIMEOUT_MS);

    // null UUID filter = scan all; cheap clones often don't advertise the
    // serial service in the scan record, so we filter ourselves in the cb.
    manager.startDeviceScan(null, null, (error, device) => {
      if (settled) return;
      if (error) {
        settled = true;
        clearTimeout(handle);
        try { manager.stopDeviceScan(); } catch { /* ignore */ }
        reject(error);
        return;
      }
      if (device && looksLikeElm327(device)) {
        settled = true;
        clearTimeout(handle);
        try { manager.stopDeviceScan(); } catch { /* ignore */ }
        resolve(device);
      }
    });
  });
}

/**
 * After connecting, discover services and pick the serial characteristic:
 * first a candidate service with a writable+notifiable char, else ANY service
 * exposing such a pair. Returns the chosen ids or throws.
 */
async function pickSerialCharacteristic(device: BleDevice): Promise<{
  serviceId: string;
  charId: string;
  writeWithResponse: boolean;
}> {
  const services = await device.services();

  // Build a quick lookup of service uuid (lowercased) -> chars.
  const byService = new Map<string, BleCharacteristic[]>();
  for (const svc of services) {
    byService.set(svc.uuid.toLowerCase(), await svc.characteristics());
  }

  const tryService = (svcUuid: string): {
    serviceId: string; charId: string; writeWithResponse: boolean;
  } | null => {
    const chars = byService.get(svcUuid.toLowerCase());
    if (!chars) return null;
    // Prefer a single char that is BOTH writable and notifiable (the classic
    // FFE1 serial pipe). Otherwise accept a writable char in the same service
    // that also has a notifiable sibling — but the single-char case is by far
    // the most common on these clones.
    const both = chars.find(
      (c) => (c.isWritableWithResponse || c.isWritableWithoutResponse) && c.isNotifiable
    );
    if (both) {
      return {
        serviceId: svcUuid,
        charId: both.uuid,
        writeWithResponse: both.isWritableWithResponse,
      };
    }
    return null;
  };

  // 1) Probe the known candidate services in priority order.
  for (const cand of CANDIDATE_SERVICES) {
    const hit = tryService(cand);
    if (hit) return hit;
  }

  // 2) Fall back to scanning every discovered service for a writable+notifiable
  //    characteristic — handles clones with entirely non-standard UUIDs.
  for (const [svcUuid] of byService) {
    const hit = tryService(svcUuid);
    if (hit) return hit;
  }

  throw new Error("Connected device exposes no writable+notifiable serial characteristic (not an ELM327?).");
}

/**
 * Full connect path: scan → connect → discover → wire notifications → run the
 * ELM327 AT init handshake. On ANY failure we clean up and throw, so the
 * facade can fall back to classic Bluetooth, then the simulation. Resolves
 * with the device MAC/id.
 */
export async function connect(): Promise<{ mac: string; name: string | null }> {
  const manager = getManager();
  if (!manager) throw new Error("BLE is not available on this device.");

  // Bluetooth adapter must be powered on.
  const state = await withTimeout(manager.state(), 3_000, "adapter state");
  if (state !== "PoweredOn") {
    throw new Error(`Bluetooth is ${state}. Turn Bluetooth on and try again.`);
  }

  const device = await scanForDevice(manager);
  const connected = await withTimeout(
    manager.connectToDevice(device.id, { requestMTU: 247 }),
    CONNECT_TIMEOUT_MS,
    "connect"
  );
  await withTimeout(
    connected.discoverAllServicesAndCharacteristics(),
    CONNECT_TIMEOUT_MS,
    "discover"
  );

  const picked = await pickSerialCharacteristic(connected);

  // Wire a single long-lived notification subscription. We accumulate ASCII
  // chunks into rxBuffer and, when a `>` prompt is seen, hand the buffered
  // response to whoever is currently awaiting it.
  const newLink: BleLink = {
    device: connected,
    serviceId: picked.serviceId,
    charId: picked.charId,
    writeWithResponse: picked.writeWithResponse,
    sub: undefined as unknown as BleSubscription, // set just below
    rxBuffer: "",
    waiter: null,
    supportedPids: null,
  };

  newLink.sub = connected.monitorCharacteristicForService(
    picked.serviceId,
    picked.charId,
    (error, characteristic) => {
      if (error || !characteristic?.value) return;
      newLink.rxBuffer += base64ToAscii(characteristic.value);
      if (newLink.rxBuffer.includes(">")) {
        const full = newLink.rxBuffer;
        newLink.rxBuffer = "";
        const w = newLink.waiter;
        newLink.waiter = null;
        if (w) w(full);
      }
    }
  );

  link = newLink;

  try {
    await runInitHandshake(sendCommand, LOG_TAG);
  } catch (e) {
    // Init failed — tear the half-open link down so we cleanly fall back.
    await disconnect();
    throw e;
  }

  // Discover which Mode 01 PIDs this ECU actually answers (0100 covers
  // PIDs 01-20, 0140 covers 41-60 — together they cover every PID our
  // 8-field read needs, including 0142 which lives in the second range).
  // Best-effort: if discovery itself fails, leave supportedPids null so
  // readObdRaw() falls back to trying every target PID directly, same as
  // before this existed.
  try {
    newLink.supportedPids = await discoverSupportedPids(sendCommand, LOG_TAG);
    const list = [...newLink.supportedPids].sort((a, b) => a - b).map((p) => "0x" + p.toString(16).padStart(2, "0"));
    console.log(`${LOG_TAG} PID support discovered: [${list.join(",")}]`);
  } catch (e) {
    console.log(`${LOG_TAG} PID support discovery failed (will try every target PID directly): ${e instanceof Error ? e.message : String(e)}`);
    newLink.supportedPids = null;
  }

  return { mac: connected.id, name: connected.name };
}

// ─────────────────────────────────────────────────────────────────────────
// ELM327 command transport
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write an ASCII command (terminated with `\r`) and wait for the `>` prompt.
 * Returns the raw ASCII response (including echoes/whitespace; callers parse).
 */
function sendCommand(cmd: string): Promise<string> {
  const l = link;
  if (!l) return Promise.reject(new Error("Not connected."));

  console.log(`${LOG_TAG} TX ${cmd}`);
  const payload = asciiToBase64(`${cmd}\r`);

  const wait = new Promise<string>((resolve) => {
    l.rxBuffer = "";
    l.waiter = resolve;
  });

  const write = l.writeWithResponse
    ? l.device.writeCharacteristicWithResponseForService(l.serviceId, l.charId, payload)
    : l.device.writeCharacteristicWithoutResponseForService(l.serviceId, l.charId, payload);

  // The write itself can also hang; race both against the prompt timeout.
  return withTimeout(
    write.then(() => wait),
    PROMPT_TIMEOUT_MS,
    `cmd ${cmd}`
  ).then((resp) => {
    console.log(`${LOG_TAG} RX ${cmd} -> "${sanitizeForLog(resp)}"`);
    return resp;
  }).catch((e) => {
    // Drop a stale waiter so the next command starts clean.
    if (l.waiter) l.waiter = null;
    console.log(`${LOG_TAG} TIMEOUT/ERROR ${cmd} -> ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  });
}

/** Query one PID via the shared protocol logic, tagged for BLE in the logs. */
function queryPid(pid: string): Promise<number[] | null> {
  return protocolQueryPid(sendCommand, pid, LOG_TAG);
}

/**
 * Read all the PIDs we can map to TriageOBDData. Returns null if the link is
 * gone. Each PID is best-effort: a missing one just leaves its field
 * `undefined`. The fields NOT covered here are intentionally absent — see the
 * file header for why a generic OBD-II port can't supply them.
 */
export async function readObd(): Promise<TriageOBDData | null> {
  if (!link) return null;

  // Partial accumulator — only `available` is guaranteed. We fill what the
  // car answers. `as` keeps the public type stable while letting us omit the
  // non-standard fields (the backend guards every field with `!== undefined`).
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

  // 010F — Intake air temperature = A - 40  (°C). Used as a proxy for
  // `engine_temp_c` (there is no standard "engine block temp" PID; coolant
  // temp above is the canonical engine-thermal signal, intake is supplementary).
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
 * Read the Mode 01 PIDs the trip recorder needs. Returns null only if there's
 * no live link at all; individual PIDs that don't answer are simply omitted
 * from the result rather than failing the whole read.
 */
export async function readObdRaw(): Promise<RawObdPids | null> {
  if (!link) {
    console.log(`${LOG_TAG} readObdRaw: no live link — skipping (caller falls back to synthetic)`);
    return null;
  }
  return readObdRawGeneric(sendCommand, link.supportedPids, LOG_TAG);
}

// ─────────────────────────────────────────────────────────────────────────
// Teardown
// ─────────────────────────────────────────────────────────────────────────

/** Drop the BLE connection and clear the link. Safe to call when not connected. */
export async function disconnect(): Promise<void> {
  const l = link;
  link = null;
  if (!l) return;
  try { l.sub.remove(); } catch { /* ignore */ }
  try { await l.device.cancelConnection(); } catch { /* ignore */ }
}

// Re-export the shared types for the facade's convenience.
export type { TriageOBDData, VehicleState };
export type { RawObdPids };
