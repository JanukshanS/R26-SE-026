/**
 * ============================================================================
 * Engine-state monitor — detects the engine starting and stopping
 * ============================================================================
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The dongle can be paired while the car is off, but with the ignition off the
 * ECU is asleep and every Mode 01 PID query comes back empty — so polling RPM
 * to find out whether the engine has started can't work: "engine off" and "bus
 * asleep" are the same silence, and each unanswered PID costs a 4s timeout.
 *
 * THE SIGNAL
 * ----------
 * `ATRV` is answered by the ADAPTER itself, reading OBD-II pin 16 — permanent
 * +12V, not switched by the ignition. It returns in ~50ms with the car fully
 * off and needs no bus transaction, which is what makes a 5-second poll viable.
 *
 *   engine off, resting battery   ~12.2–12.6V
 *   cranking (brief)              ~9–10V
 *   engine running (charging)     ~13.5–14.5V
 *
 * WHY VOLTAGE LEADS AND RPM FOLLOWS
 * ---------------------------------
 * The target vehicle is a Toyota Aqua — a hybrid. Its petrol engine shuts down
 * at every red light while the DC-DC converter holds the 12V bus at 13.5–14V.
 * RPM-triggered logic would end a trip at every traffic light. Voltage stays
 * high because the vehicle is still in use, which is the right answer for trip
 * recording. So RPM is only ever a CONFIRMATION probe at transition moments,
 * never the trigger and never a routine poll.
 *
 * OBSERVE-ONLY (for now)
 * ----------------------
 * The state machine runs and reports, but the `onEngineStart`/`onEngineStop`
 * handlers are currently wired to no-ops by `use-auto-trip-controller.ts`.
 * That's deliberate: the voltage thresholds below need validating against a
 * real car over several drives before they're trusted to start and stop
 * recording on their own. Those two handlers are the only seam that changes.
 */

import { getRestingBaseline, recordRestingVoltage } from "./autoTripSettings";
import { isRealBackend, readEngineSignals } from "./elm327";

const LOG_TAG = "[EngineMonitor]";

export type EngineState =
  /** No confident reading yet (just started, or recovering from a loss). */
  | "unknown"
  /** Adapter answering, voltage in the resting-battery band. */
  | "engine-off"
  /** Observational only — see the note on transitions below. */
  | "cranking"
  | "running"
  /** Adapter NOT answering. Explicitly distinct from "engine-off". */
  | "adapter-lost";

// ── Voltage thresholds (12V systems) ──────────────────────────────────────
//
// CALIBRATED against a real Toyota Aqua (hybrid) on 2026-08-10, not assumed:
//     resting, ignition off : 11.6 - 12.1 V
//     running (DC-DC)       : 13.0 - 13.5 V
//
// A hybrid's DC-DC converter holds a LOWER and flatter bus voltage than a
// conventional alternator (13.0-13.5 rather than 13.5-14.5). The original
// 13.2 floor was set from generic alternator figures and left only 0.1 V of
// headroom - it rejected a genuine 13.0 V sample at startup and delayed
// detection by a whole poll. These values sit in the middle of the measured
// 1.5 V gap instead, so they tolerate both a weaker battery and a hotter,
// sagging bus.
const V_RUNNING_MIN = 12.8;  // measured running floor 13.0, so 0.2 V margin
const V_OFF_MAX     = 12.5;  // measured resting ceiling 12.1, so 0.4 V margin
const V_CRANK_MAX   = 10.5;  // starter inrush dip (observed 11.6 on this car)
const V_RISE_MIN    = 0.8;   // required rise above the learned resting baseline
const V_PLAUSIBLE_HI = 16.5; // above this: clone garbage, or a 24V system

// The 12.5-12.8 gap is a DELIBERATE dead zone. A freshly-charged battery holds
// surface charge for minutes after shutdown, and a hot bus can sag. A single
// threshold would oscillate across exactly that region. Inside the band we
// hold state and reset nothing: it is evidence for neither side.

// ── Confirmation counts ───────────────────────────────────────────────────
const START_SAMPLES_FAST = 2;  // + RPM confirmation
const START_SAMPLES_SLOW = 3;  // + rise above baseline
const STOP_SAMPLES       = 4;  // deliberately slower/stricter than starting
const LOST_SAMPLES       = 3;  // NOT 1 — see the note in evaluate()

const RPM_RUNNING_MIN = 400;
const RPM_STOPPED_MAX = 300;

// ── Poll cadence ──────────────────────────────────────────────────────────
const POLL_OFF_MS        = 5_000;   // hunting for a start — must be responsive
const POLL_RUNNING_MS    = 10_000;  // only watching for a stop; less urgent
const POLL_IDLE_MS       = 15_000;  // after sitting in engine-off a long while
const IDLE_SLOW_AFTER_MS = 10 * 60_000;
const LOST_BACKOFF_MS    = [5_000, 10_000, 20_000, 30_000];

/**
 * Minimum gap between persisted resting-voltage samples. Without this the
 * monitor would write the settings file on every poll for as long as the car
 * sits parked — pointless I/O, and the rolling window only holds 9 samples
 * anyway. Spacing them out also makes the median span real time rather than
 * nine readings from the same 45-second window.
 */
const RESTING_SAMPLE_MIN_GAP_MS = 60_000;

export interface EngineMonitorSnapshot {
  state: EngineState;
  voltage: number | null;
  rpm: number | null;
  restingBaselineV: number | null;
  /** Consecutive samples supporting the pending transition. */
  consecutiveInBand: number;
  lastPollAt: number;
  /** How long the adapter has been unreachable, or null if it isn't. */
  adapterLostSinceMs: number | null;
}

export interface EngineMonitorHandlers {
  onEngineStart?(): void;
  onEngineStop?(): void;
  onAdapterLost?(sinceMs: number): void;
}

// ── Module state (singleton, same idiom as tripRecorder.ts) ───────────────
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let handlers: EngineMonitorHandlers = {};
let vehicleId = "";

let state: EngineState = "unknown";
let lastVoltage: number | null = null;
let lastRpm: number | null = null;
let lastPollAt = 0;

let runBandCount = 0;   // consecutive samples in the running band
let offBandCount = 0;   // consecutive samples in the off band
let failCount = 0;      // consecutive adapter-unreachable polls
let sawCrankDip = false;
let adapterLostSince: number | null = null;
let engineOffSince: number | null = null;
let lastRestingSampleAt = 0;

const listeners = new Set<(s: EngineMonitorSnapshot) => void>();

export function onEngineStateChange(cb: (s: EngineMonitorSnapshot) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getEngineSnapshot(): EngineMonitorSnapshot {
  return {
    state,
    voltage: lastVoltage,
    rpm: lastRpm,
    restingBaselineV: vehicleId ? getRestingBaseline(vehicleId) : null,
    consecutiveInBand: state === "running" ? offBandCount : runBandCount,
    lastPollAt,
    adapterLostSinceMs: adapterLostSince === null ? null : Date.now() - adapterLostSince,
  };
}

function notify(): void {
  const snap = getEngineSnapshot();
  listeners.forEach((cb) => {
    try {
      cb(snap);
    } catch (e) {
      console.log(`${LOG_TAG} listener threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function isEngineMonitorRunning(): boolean {
  return running;
}

export function startEngineMonitor(opts: {
  vehicleId: string;
  handlers?: EngineMonitorHandlers;
}): void {
  // Idempotent: repeated calls (pairing events, AppState churn) must not
  // stack timers or wipe the handlers of an already-running monitor.
  if (running) {
    retargetEngineMonitor(opts.vehicleId);
    return;
  }
  vehicleId = opts.vehicleId;
  handlers = opts.handlers ?? {};
  running = true;
  resetCounters();
  state = "unknown";
  console.log(`${LOG_TAG} started (vehicle=${vehicleId}, baseline=${getRestingBaseline(vehicleId) ?? "not learned yet"})`);
  schedule(0);
}

/**
 * Point the monitor at a different vehicle without restarting it — the driver
 * switching cars on Home. Counters and baseline are per-vehicle, so a
 * different car's voltages aren't comparable and everything resets.
 */
export function retargetEngineMonitor(nextVehicleId: string): void {
  if (!running || nextVehicleId === vehicleId) return;
  console.log(`${LOG_TAG} vehicle changed ${vehicleId} -> ${nextVehicleId}; resetting counters`);
  vehicleId = nextVehicleId;
  resetCounters();
  setState("unknown");
}

export function stopEngineMonitor(): void {
  if (!running) return;
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  console.log(`${LOG_TAG} stopped`);
}

function resetCounters(): void {
  runBandCount = 0;
  offBandCount = 0;
  failCount = 0;
  sawCrankDip = false;
  adapterLostSince = null;
  engineOffSince = null;
  lastRestingSampleAt = 0;
}

/**
 * Self-rescheduling `setTimeout`, NOT `setInterval`. A concurrent 8-PID trip
 * sample can hold the OBD lock for up to 32s; with setInterval the queued
 * polls would all fire in a burst the moment it frees. Scheduling from
 * completion means a slow poll simply means a later next poll.
 */
function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void poll();
  }, delayMs);
}

function nextDelay(): number {
  if (state === "adapter-lost") {
    return LOST_BACKOFF_MS[Math.min(failCount - LOST_SAMPLES, LOST_BACKOFF_MS.length - 1)] ?? 30_000;
  }
  if (state === "running") return POLL_RUNNING_MS;
  if (state === "engine-off" && engineOffSince !== null && Date.now() - engineOffSince > IDLE_SLOW_AFTER_MS) {
    // Parked a long time: back off to save phone battery and BLE airtime.
    return POLL_IDLE_MS;
  }
  return POLL_OFF_MS;
}

async function poll(): Promise<void> {
  if (!running) return;

  // The simulator always looks like a running engine (synthesizeObd floors RPM
  // at 700 and reports ~13.9V), so it must never reach this state machine.
  if (!isRealBackend()) {
    console.log(`${LOG_TAG} no real dongle — stopping`);
    stopEngineMonitor();
    return;
  }

  // RPM is only worth the bus round-trip when we're near a transition.
  const probeRpm =
    (state !== "running" && lastVoltage !== null && lastVoltage >= V_RUNNING_MIN) ||
    (state === "running" && lastVoltage !== null && lastVoltage < V_OFF_MAX);

  const signals = await readEngineSignals({ probeRpm });
  if (!running) return; // stopped while the read was in flight

  lastPollAt = Date.now();

  if (!signals || !signals.adapterAlive) {
    onAdapterFailure();
  } else {
    failCount = 0;
    if (adapterLostSince !== null) {
      console.log(`${LOG_TAG} adapter recovered after ${Math.round((Date.now() - adapterLostSince) / 1000)}s`);
      adapterLostSince = null;
      resetCounters();
      setState("unknown");
    }
    lastVoltage = signals.voltage;
    lastRpm = signals.rpm;
    evaluate(signals.voltage, signals.rpm);
  }

  notify();
  schedule(nextDelay());
}

function onAdapterFailure(): void {
  failCount += 1;
  lastVoltage = null;
  lastRpm = null;

  // THREE consecutive failures, not one. The 12V rail browns out during
  // cranking and a cheap adapter can drop a command right at the moment of
  // engine start — the exact moment we care about most. A 1-failure rule
  // would make every successful start look like a disconnect.
  if (failCount >= LOST_SAMPLES && state !== "adapter-lost") {
    if (adapterLostSince === null) adapterLostSince = Date.now();
    setState("adapter-lost");
    handlers.onAdapterLost?.(Date.now() - adapterLostSince);
  } else if (failCount < LOST_SAMPLES) {
    console.log(`${LOG_TAG} adapter did not answer (${failCount}/${LOST_SAMPLES} before declaring it lost)`);
  }
}

function evaluate(voltage: number | null, rpm: number | null): void {
  if (voltage === null) {
    // Adapter alive but the value was garbage — no evidence either way.
    console.log(`${LOG_TAG} adapter answered but voltage unparseable; holding state=${state}`);
    return;
  }

  if (voltage > V_PLAUSIBLE_HI) {
    // Every threshold here is 12V-specific. Rather than silently
    // mis-classifying a 24V system (or a broken clone), refuse to judge.
    console.log(`${LOG_TAG} voltage ${voltage}V exceeds 12V-system range — not classifying`);
    return;
  }

  // Cranking is recorded when seen but is NEVER a precondition: a 5s poll
  // usually misses the ~1s crank dip entirely, so requiring it would be the
  // biggest false-negative trap in the design. Seeing it just makes us more
  // confident, so it relaxes the fast path to a single confirming sample.
  if (voltage <= V_CRANK_MAX) {
    if (!sawCrankDip) console.log(`${LOG_TAG} crank dip observed (${voltage}V)`);
    sawCrankDip = true;
    setState("cranking");
    return;
  }

  if (voltage >= V_RUNNING_MIN) {
    runBandCount += 1;
    offBandCount = 0;
    if (state !== "running") tryConfirmStart(voltage, rpm);
    return;
  }

  if (voltage < V_OFF_MAX) {
    offBandCount += 1;
    runBandCount = 0;
    if (state === "running" || state === "cranking" || state === "unknown") {
      tryConfirmStop(voltage, rpm);
    } else if (state === "engine-off") {
      // Keep learning what this car reads at rest, for the rise test.
      noteRestingVoltage(voltage);
    }
    return;
  }

  // Dead zone — hold state, reset nothing.
}

function tryConfirmStart(voltage: number, rpm: number | null): void {
  const baseline = getRestingBaseline(vehicleId);
  const needFast = sawCrankDip ? 1 : START_SAMPLES_FAST;

  // Fast path: a woken bus reporting rotation is unambiguous. The ECU only
  // wakes and reports RPM when the engine is actually turning.
  if (runBandCount >= needFast && rpm !== null && rpm >= RPM_RUNNING_MIN) {
    console.log(`${LOG_TAG} start confirmed by RPM (${voltage}V, ${rpm}rpm, ${runBandCount} samples)`);
    enterRunning();
    return;
  }

  // Slow path: a sustained RISE above this car's learned resting voltage.
  // The rise requirement is what defeats a battery charger — a charger holds
  // a steady high voltage, an alternator produces a step change.
  if (runBandCount >= START_SAMPLES_SLOW && baseline !== null && voltage - baseline >= V_RISE_MIN) {
    console.log(
      `${LOG_TAG} start confirmed by voltage rise (${voltage}V vs baseline ${baseline}V, ${runBandCount} samples)`
    );
    enterRunning();
    return;
  }

  // No baseline learned yet (first ever drive): fall back to sustained
  // absolute voltage alone, requiring more samples for the weaker evidence.
  if (runBandCount >= START_SAMPLES_SLOW && baseline === null) {
    console.log(`${LOG_TAG} start confirmed by sustained voltage, no baseline yet (${voltage}V, ${runBandCount} samples)`);
    enterRunning();
    return;
  }

  console.log(`${LOG_TAG} possible start: ${voltage}V (${runBandCount} in band, rpm=${rpm ?? "not probed"})`);
}

function tryConfirmStop(voltage: number, rpm: number | null): void {
  if (offBandCount < STOP_SAMPLES) {
    console.log(`${LOG_TAG} possible stop: ${voltage}V (${offBandCount}/${STOP_SAMPLES})`);
    return;
  }
  // RPM confirms, but only as a veto: if the bus still reports the engine
  // turning, don't call it stopped regardless of voltage.
  if (rpm !== null && rpm > RPM_STOPPED_MAX) {
    console.log(`${LOG_TAG} voltage says stopped but RPM is ${rpm} — holding`);
    return;
  }
  const wasRunning = state === "running";
  console.log(`${LOG_TAG} stop confirmed (${voltage}V, rpm=${rpm ?? "no answer"}, ${offBandCount} samples)`);
  sawCrankDip = false;
  engineOffSince = Date.now();
  setState("engine-off");
  noteRestingVoltage(voltage);
  // Only a genuine running -> off transition is an engine stop. Settling into
  // engine-off from `unknown` (app opened on a parked car) or from `cranking`
  // (a start that didn't take) must not fire it.
  if (wasRunning) handlers.onEngineStop?.();
}

/**
 * Persist a resting-voltage sample, rate-limited. Called on every poll while
 * parked, but only writes occasionally — see RESTING_SAMPLE_MIN_GAP_MS.
 */
function noteRestingVoltage(voltage: number): void {
  const now = Date.now();
  if (now - lastRestingSampleAt < RESTING_SAMPLE_MIN_GAP_MS) return;
  lastRestingSampleAt = now;
  recordRestingVoltage(vehicleId, voltage);
}

function enterRunning(): void {
  sawCrankDip = false;
  engineOffSince = null;
  setState("running");
  handlers.onEngineStart?.();
}

function setState(next: EngineState): void {
  if (state === next) return;
  console.log(`${LOG_TAG} ${state} -> ${next}  (V=${lastVoltage ?? "?"} rpm=${lastRpm ?? "?"})`);
  state = next;
}
