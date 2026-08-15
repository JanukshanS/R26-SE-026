/**
 * ============================================================================
 * ELM327 Protocol — shared, transport-agnostic AT/PID logic
 * ============================================================================
 *
 * The actual command/response protocol (ATZ/ATE0/.../ATSP0 handshake, Mode 01
 * PID queries, hex parsing, PID-support-bitmask discovery) is identical
 * whether the bytes travel over BLE GATT (`elm327.ble.ts`) or classic
 * Bluetooth RFCOMM (`elm327.classic.ts`) — only how a command gets sent and a
 * response comes back differs. Each transport implements a `SendCommandFn`
 * (write the command, resolve with the raw response once the ELM327's `>`
 * prompt arrives) and hands it to the functions here, so the protocol logic
 * — including all its diagnostic logging — is written and tested exactly once.
 */

export type SendCommandFn = (cmd: string) => Promise<string>;

/**
 * PIDs needed by the predictive-maintenance trip recorder (`tripRecorder.ts`)
 * — a different feature set (speed, LTFT, throttle) than the triage-shaped
 * `TriageOBDData` in `elm327.sim.ts`. Best-effort per field: a PID the car
 * doesn't answer is left `undefined` and the caller decides the fallback.
 */
export interface RawObdPids {
  rpm?: number;
  speed_kmh?: number;
  coolant_temp_c?: number;
  battery_voltage_v?: number;
  ltft_percent?: number;
  throttle_percent?: number;
  engine_load_percent?: number;
  intake_air_temp_c?: number;
}

/**
 * Engine-state signals for `engineMonitor.ts`. Deliberately NOT part of
 * `RawObdPids`: these are read on a different cadence, for a different purpose,
 * and `voltage` comes from the ADAPTER (ATRV, OBD pin 16 — permanently live,
 * not switched by the ignition) rather than from the ECU, so it answers even
 * with the car fully off. That is the whole point: it's the only signal
 * available before the engine has been started.
 */
export interface EngineSignals {
  /** ATRV volts at OBD pin 16. null = the adapter answered but unparseably. */
  voltage: number | null;
  /**
   * 010C RPM — only probed when `probeRpm` was requested. null means either
   * "not probed" or "the bus is asleep / didn't answer", which are the same
   * fact for engine-state purposes.
   */
  rpm: number | null;
  /**
   * Did the adapter reply to ATRV at all. This is the ONLY way to distinguish
   * "engine off, adapter fine" from "adapter unreachable" — they look identical
   * in every other signal and demand opposite handling upstream (stop the trip
   * vs. keep recording and retry).
   */
  adapterAlive: boolean;
}

// ── Command serialization ──────────────────────────────────────────────────
// Each transport's `sendCommand` stores its resolver in a SINGLE SLOT, not a
// queue (see `waiter` in elm327.ble.ts / elm327.classic.ts): two overlapping
// commands clobber each other's resolver and both hang until timeout. Every
// caller used to be strictly sequential so this never bit, but the engine
// monitor polls on its own timer, so it no longer holds. Every multi-command
// sequence must run inside this lock.
let chain: Promise<unknown> = Promise.resolve();

export function withObdLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  const run = chain.then(
    // Run regardless of whether the predecessor resolved or rejected — one
    // caller's timeout must not cancel everyone behind it.
    () => runLogged(label, queuedAt, fn),
    () => runLogged(label, queuedAt, fn)
  );
  // A rejection here must never poison the chain for subsequent callers.
  chain = run.catch(() => {});
  return run;
}

function runLogged<T>(label: string, queuedAt: number, fn: () => Promise<T>): Promise<T> {
  const waited = Date.now() - queuedAt;
  // Only worth a line when the wait was long enough to delay a poll — an
  // 8-PID read against a dead link holds the lock for up to 32s.
  if (waited > 2000) console.log(`[ELM327:Lock] "${label}" waited ${waited}ms for the bus`);
  return fn();
}

export function sanitizeForLog(s: string): string {
  return s.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/**
 * Standard ELM327 bring-up. Each line is ASCII + `\r`, terminated by `>`.
 *   ATZ   — reset (slow; give it room)
 *   ATE0  — echo off (so responses aren't prefixed with the command)
 *   ATL0  — linefeeds off
 *   ATS0  — spaces off (compact hex)
 *   ATSP0 — automatic protocol detection
 * We tolerate individual command hiccups except ATZ; a dongle that won't
 * reset isn't usable.
 */
export async function runInitHandshake(sendCommand: SendCommandFn, logTag: string): Promise<void> {
  await sendCommand("ATZ"); // must succeed
  for (const cmd of ["ATE0", "ATL0", "ATS0", "ATSP0"]) {
    try {
      await sendCommand(cmd);
    } catch (e) {
      console.log(`${logTag} init step ${cmd} failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${logTag} init handshake complete`);
}

/**
 * Parse an ELM327 Mode 01 response into its data bytes. For a request `01XX`
 * the positive response starts with `41 XX` then the data bytes. With ATS0
 * (spaces off) a response looks like `410C1AF8`. We locate the `41XX` marker
 * and return the bytes after it. Returns null if the response is an error
 * ("NO DATA", "?", "SEARCHING", "UNABLE TO CONNECT") or doesn't match.
 */
export function parsePidBytes(pid: string, raw: string, logTag: string): number[] | null {
  // Normalize: strip prompt, whitespace, echoes; uppercase hex only.
  const cleaned = raw
    .toUpperCase()
    .replace(/[\r\n>]/g, " ")
    .replace(/\s+/g, "");

  // Look for the marker FIRST. A response can legitimately contain
  // "SEARCHING..." (the adapter still locking the protocol) followed by a
  // still-valid answer once it settles — sometimes from a second ECU that
  // replied to the same broadcast query. Only treat error/status text as
  // fatal when no usable marker ever showed up; otherwise we'd throw away
  // perfectly good data.
  const marker = `41${pid.slice(2).toUpperCase()}`; // e.g. "010C" → "410C"
  const idx = cleaned.indexOf(marker);
  if (idx === -1) {
    if (
      cleaned.includes("NODATA") ||
      cleaned.includes("UNABLE") ||
      cleaned.includes("SEARCHING") ||
      cleaned.includes("STOPPED") ||
      cleaned.includes("ERROR") ||
      cleaned.includes("?")
    ) {
      console.log(`${logTag} PID ${pid} rejected: car/adapter reported an error — raw="${sanitizeForLog(raw)}"`);
    } else {
      console.log(`${logTag} PID ${pid} rejected: marker "${marker}" not found — raw="${sanitizeForLog(raw)}" cleaned="${cleaned}"`);
    }
    return null;
  }

  // Cap at 4 data bytes (8 hex chars) — every PID we query needs at most 4
  // (the PID-support bitmasks), and multiple ECUs on the bus sometimes each
  // answer the same broadcast query, which otherwise concatenates a second
  // full response right after the first and corrupts the byte count.
  const hex = cleaned.slice(idx + marker.length, idx + marker.length + 8);
  if (hex.length < 2 || hex.length % 2 !== 0) {
    // Trim a trailing odd nibble defensively, then re-check.
    const even = hex.slice(0, hex.length - (hex.length % 2));
    if (even.length < 2) {
      console.log(`${logTag} PID ${pid} rejected: not enough data bytes after marker — hex="${hex}"`);
      return null;
    }
    const bytes = splitBytes(even);
    console.log(`${logTag} PID ${pid} parsed (odd-length, trimmed): bytes=[${bytes.join(",")}]`);
    return bytes;
  }
  const bytes = splitBytes(hex);
  console.log(`${logTag} PID ${pid} parsed: bytes=[${bytes.join(",")}]`);
  return bytes;
}

function splitBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(b)) break;
    bytes.push(b);
  }
  return bytes;
}

/** Query one PID, returning its data bytes (or null on no-data/timeout). */
export async function queryPid(sendCommand: SendCommandFn, pid: string, logTag: string): Promise<number[] | null> {
  try {
    const raw = await sendCommand(pid);
    return parsePidBytes(pid, raw, logTag);
  } catch {
    return null; // timeout / write failure — treat as unavailable PID
  }
}

/**
 * Query 0100 and 0140 — each returns a 4-byte bitmask of which PIDs in that
 * 32-PID range the ECU supports. Together they cover every PID this module
 * queries (0x04..0x11 from the first range, 0x42 from the second).
 */
export async function discoverSupportedPids(sendCommand: SendCommandFn, logTag: string): Promise<Set<number>> {
  const supported = new Set<number>();
  for (const basePid of [0x00, 0x40]) {
    const pidStr = `01${basePid.toString(16).toUpperCase().padStart(2, "0")}`;
    const bytes = await queryPid(sendCommand, pidStr, logTag);
    if (!bytes || bytes.length < 4) continue;
    for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
      for (let bit = 0; bit < 8; bit++) {
        if (bytes[byteIdx] & (0x80 >> bit)) {
          supported.add(basePid + byteIdx * 8 + bit + 1);
        }
      }
    }
  }
  return supported;
}

/** True if the ECU is known to support this PID, or support is unknown. */
function isPidSupported(supportedPids: Set<number> | null, pidHex: string): boolean {
  // Null = discovery unavailable. Empty = discovery ran but got nothing back
  // (e.g. the bus was dead because ignition was off when we probed) — every
  // real OBD-II ECU supports at least a few of our target PIDs, so an empty
  // result almost certainly means discovery itself failed, not that the ECU
  // genuinely supports zero of them. Either way: try anyway rather than
  // permanently skip every PID for the rest of the connected session.
  if (!supportedPids || supportedPids.size === 0) return true;
  return supportedPids.has(parseInt(pidHex.slice(2), 16));
}

/**
 * Read the Mode 01 PIDs the trip recorder needs, skipping any PID the ECU
 * didn't advertise as supported (per `supportedPids`, or trying every one if
 * that discovery is unavailable/null). Each PID is best-effort — one that
 * doesn't answer just leaves its field `undefined` for the caller to decide
 * a fallback.
 */
export async function readObdRawGeneric(
  sendCommand: SendCommandFn,
  supportedPids: Set<number> | null,
  logTag: string
): Promise<RawObdPids> {
  console.log(`${logTag} readObdRaw: starting read of supported PIDs...`);

  const out: RawObdPids = {};
  const skipped: string[] = [];
  const supported = (pid: string) => isPidSupported(supportedPids, pid);

  // 010C — Engine RPM = ((A*256)+B)/4
  if (supported("010C")) {
    const rpm = await queryPid(sendCommand, "010C", logTag);
    if (rpm && rpm.length >= 2) out.rpm = Number((((rpm[0] * 256) + rpm[1]) / 4).toFixed(0));
  } else skipped.push("010C(rpm)");

  // 010D — Vehicle speed = A (km/h, single byte)
  if (supported("010D")) {
    const speed = await queryPid(sendCommand, "010D", logTag);
    if (speed && speed.length >= 1) out.speed_kmh = speed[0];
  } else skipped.push("010D(speed)");

  // 0105 — Engine coolant temperature = A - 40 (°C)
  if (supported("0105")) {
    const coolant = await queryPid(sendCommand, "0105", logTag);
    if (coolant && coolant.length >= 1) out.coolant_temp_c = coolant[0] - 40;
  } else skipped.push("0105(coolant)");

  // 0142 — Control module voltage = ((A*256)+B)/1000 (V) — closest standard
  // PID to "battery voltage"; the ECU supply rail tracks it closely.
  if (supported("0142")) {
    const ctrlV = await queryPid(sendCommand, "0142", logTag);
    if (ctrlV && ctrlV.length >= 2) {
      out.battery_voltage_v = Number((((ctrlV[0] * 256) + ctrlV[1]) / 1000).toFixed(2));
    }
  } else skipped.push("0142(battery)");

  // 0107 — Long Term Fuel Trim, Bank 1 = (A-128) * 100/128 (%)
  if (supported("0107")) {
    const ltft = await queryPid(sendCommand, "0107", logTag);
    if (ltft && ltft.length >= 1) out.ltft_percent = Number((((ltft[0] - 128) * 100) / 128).toFixed(2));
  } else skipped.push("0107(ltft)");

  // 0111 — Throttle position = A * 100/255 (%)
  if (supported("0111")) {
    const throttle = await queryPid(sendCommand, "0111", logTag);
    if (throttle && throttle.length >= 1) out.throttle_percent = Number(((throttle[0] * 100) / 255).toFixed(1));
  } else skipped.push("0111(throttle)");

  // 0104 — Calculated engine load = A * 100/255 (%)
  if (supported("0104")) {
    const load = await queryPid(sendCommand, "0104", logTag);
    if (load && load.length >= 1) out.engine_load_percent = Number(((load[0] * 100) / 255).toFixed(1));
  } else skipped.push("0104(load)");

  // 010F — Intake air temperature = A - 40 (°C)
  if (supported("010F")) {
    const iat = await queryPid(sendCommand, "010F", logTag);
    if (iat && iat.length >= 1) out.intake_air_temp_c = iat[0] - 40;
  } else skipped.push("010F(iat)");

  if (skipped.length) {
    console.log(`${logTag} readObdRaw: skipped unsupported PIDs=[${skipped.join(",")}]`);
  }

  const answered = Object.keys(out);
  const missing = (
    ["rpm", "speed_kmh", "coolant_temp_c", "battery_voltage_v", "ltft_percent", "throttle_percent", "engine_load_percent", "intake_air_temp_c"] as const
  ).filter((k) => !(k in out));
  console.log(
    `${logTag} readObdRaw: done — ${answered.length}/8 real, answered=[${answered.join(",")}]` +
    (missing.length ? ` missing(will use synthetic)=[${missing.join(",")}]` : "")
  );

  return out;
}

// ── Engine-state signals ───────────────────────────────────────────────────

/** Volts outside this range are clone garbage, not a reading. */
const V_MIN_SANE = 4.0;
const V_MAX_SANE = 36.0;

/**
 * Parse an ELM327 `ATRV` reply into volts. Unlike a Mode 01 response this is
 * NOT a `41XX` frame — the adapter answers in plain text ("12.5V"), so
 * `parsePidBytes` can't be reused. Echo may or may not be off, so the command
 * itself can be present: "ATRV\r12.5V\r\r>".
 */
export function parseAdapterVoltage(raw: string, logTag: string): number | null {
  const cleaned = raw.toUpperCase().replace(/[\r\n>]/g, " ").trim();
  const m = cleaned.match(/(\d{1,2}(?:\.\d+)?)\s*V/);
  if (!m) {
    console.log(`${logTag} ATRV unparseable — raw="${sanitizeForLog(raw)}"`);
    return null;
  }
  const volts = parseFloat(m[1]);
  if (!Number.isFinite(volts) || volts < V_MIN_SANE || volts > V_MAX_SANE) {
    console.log(`${logTag} ATRV out of range (${volts}V) — treating as garbage, raw="${sanitizeForLog(raw)}"`);
    return null;
  }
  return volts;
}

/**
 * Read the signals the engine monitor needs.
 *
 * ATRV is answered by the adapter itself off OBD pin 16 (permanent +12V, not
 * switched by the ignition) with no bus transaction, so it returns in ~50ms
 * even when the ECU is fast asleep — and it never costs the 4s bus timeout
 * unless the link itself is dead. That's what makes a 5-second poll viable.
 *
 * RPM is a confirmation probe for transitions only, never a routine poll: a
 * PID query against a sleeping bus costs a full timeout and wakes nothing.
 *
 * Never throws — worst case reports `adapterAlive: false`.
 */
export async function readEngineSignalsGeneric(
  sendCommand: SendCommandFn,
  opts: { probeRpm: boolean },
  logTag: string
): Promise<EngineSignals> {
  let raw: string;
  try {
    raw = await sendCommand("ATRV");
  } catch (e) {
    // A THROWN sendCommand is a transport failure (timeout/write error) —
    // i.e. the adapter is unreachable. Distinct from "answered, engine off".
    console.log(`${logTag} ATRV failed (adapter unreachable): ${e instanceof Error ? e.message : String(e)}`);
    return { voltage: null, rpm: null, adapterAlive: false };
  }

  // Resolved at all ⇒ the adapter is alive, even if the value won't parse.
  const voltage = parseAdapterVoltage(raw, logTag);

  let rpm: number | null = null;
  if (opts.probeRpm) {
    // Not gated on isPidSupported: 010C is universal, and discovery may
    // legitimately have come back empty if it ran with the ignition off.
    const bytes = await queryPid(sendCommand, "010C", logTag);
    if (bytes && bytes.length >= 2) rpm = Number((((bytes[0] * 256) + bytes[1]) / 4).toFixed(0));
  }

  console.log(
    `${logTag} engineSignals: voltage=${voltage ?? "?"}V` +
    (opts.probeRpm ? ` rpm=${rpm ?? "no-answer"}` : " (rpm not probed)")
  );
  return { voltage, rpm, adapterAlive: true };
}
