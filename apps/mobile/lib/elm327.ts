/**
 * ============================================================================
 * ELM327 Service — simulated Bluetooth OBD-II reader (mobile-side, no backend)
 * ============================================================================
 *
 * Models a Bluetooth ELM327 dongle plugged into the vehicle's OBD-II port.
 * In production this file is the place to swap in real Bluetooth I/O via
 * `react-native-ble-plx` + OBD-II PID parsing. For the demo we generate
 * realistic readings entirely on-device so dispatch is no longer dependent
 * on Herath's predictive-maintenance service being up.
 *
 * Design properties:
 *   - "Paired" state is module-global (mirrors how a real Bluetooth handle
 *     persists for the app session).
 *   - When pairing happens we lock in a single "vehicle condition" for the
 *     session — subsequent reads return readings consistent with that
 *     condition (with small jitter to simulate live telemetry).
 *   - If no device is paired (driver has a "manual" vehicle), reads return
 *     `null` and the triage engine falls back to Tier-1 (questionnaire only).
 *
 * This is the cross-component decoupling the user asked for: dispatch's
 * Tier-2 path now flows from the vehicle's own sensors, not from another
 * student's service.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

export interface TriageOBDData {
  battery_voltage_v:      number;
  battery_temp_c:         number;
  battery_charge_percent: number;
  battery_health_percent: number;
  alternator_output_v:    number;
  engine_temp_c:          number;
  coolant_temp_c:         number;
  engine_rpm:             number;
  oil_pressure_psi:       number;
  fuel_level_percent:     number;
  engine_load_percent:    number;
  ambient_temp_c:         number;
  brake_fluid_level_psi:  number;
  brake_pad_wear_mm:      number;
  brake_temp_c:           number;
  available:              true;
}

// ─────────────────────────────────────────────────────────────────────────
// Vehicle-condition presets
// ─────────────────────────────────────────────────────────────────────────
//
// Each preset is a plausible "stranded vehicle" state. At pair time we pick
// one (weighted by SL real-world frequency from the proposal §1.1) and
// stick with it for the session. Reads come back with this state's
// signature + small noise.

export type VehicleState =
  | "HEALTHY"          // driver paired before any issue
  | "BATTERY_DRAIN"    // dead/flat battery
  | "BATTERY_AGED"     // older battery struggling
  | "STARTER_AGED"     // battery OK, starter weak
  | "OVERHEATED"       // cooling problem
  | "FUEL_LOW"         // tank near empty
  | "BRAKE_WORN";      // brake pads thin

export const VEHICLE_STATES: VehicleState[] = [
  "HEALTHY",
  "BATTERY_DRAIN",
  "BATTERY_AGED",
  "STARTER_AGED",
  "OVERHEATED",
  "FUEL_LOW",
  "BRAKE_WORN",
];

const STATE_PRIOR: Record<VehicleState, number> = {
  HEALTHY:        0.25,  // many pairings happen pre-incident
  BATTERY_DRAIN:  0.25,
  BATTERY_AGED:   0.12,
  STARTER_AGED:   0.10,
  OVERHEATED:     0.10,
  FUEL_LOW:       0.08,
  BRAKE_WORN:     0.10,
};

function pickState(): VehicleState {
  const r = Math.random();
  let cum = 0;
  for (const [state, p] of Object.entries(STATE_PRIOR)) {
    cum += p;
    if (r <= cum) return state as VehicleState;
  }
  return "HEALTHY";
}

// ─────────────────────────────────────────────────────────────────────────
// Module-global pairing state (mirrors a Bluetooth connection handle)
// ─────────────────────────────────────────────────────────────────────────

interface PairingInfo {
  mac:        string;
  pairedAt:   number;
  vehicleId:  string;
  state:      VehicleState;
}

let pairing: PairingInfo | null = null;

/**
 * Tracks the incident id the current `pairing.state` was generated for. When
 * a different incident reads OBD, we re-randomize — so each new emergency
 * gets a fresh "vehicle condition" rather than every dispatch returning the
 * same diagnosis. Multiple reads within ONE incident return consistent
 * values (which is what real Bluetooth would do — telemetry doesn't flip
 * between dispatches).
 */
let lastReadIncidentId: string | null = null;
/** Set true via setForcedState() for demos — overrides the random picker. */
let forcedState: VehicleState | null = null;

export function isElm327Paired(): boolean {
  return pairing !== null;
}

export function getPairing(): Readonly<PairingInfo> | null {
  return pairing;
}

/**
 * Force the next read to use a specific state. Useful for the viva to
 * deterministically demonstrate each diagnosis pathway. Pass `null` to
 * resume random selection.
 */
export function setForcedState(state: VehicleState | null): void {
  forcedState = state;
  // Apply immediately to the active pairing so the next read reflects it.
  if (pairing && state) pairing.state = state;
}

export function getCurrentState(): VehicleState | null {
  return pairing?.state ?? null;
}

/** Simulate Bluetooth pairing. Picks a fresh "vehicle state" for the session. */
export function pairElm327(vehicleId: string): PairingInfo {
  pairing = {
    mac:       generateFakeMac(),
    pairedAt:  Date.now(),
    vehicleId,
    state:     forcedState ?? pickState(),
  };
  lastReadIncidentId = null;
  return pairing;
}

export function unpairElm327(): void {
  pairing = null;
  lastReadIncidentId = null;
}

function generateFakeMac(): string {
  const hex = "0123456789ABCDEF";
  const pick = () => hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
  return [pick(), pick(), pick(), pick(), pick(), pick()].join(":");
}

// ─────────────────────────────────────────────────────────────────────────
// Live OBD read
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read live OBD-II PIDs from the paired ELM327.
 *   - Returns null if no device is paired (manual vehicle → Tier-1).
 *   - If `incidentId` differs from the last call, the vehicle's "current
 *     condition" is re-randomized — so different emergencies surface
 *     different diagnoses. Same incident = same readings (matches what
 *     real telemetry would do during a single roadside event).
 *   - Simulates ~250ms Bluetooth latency for the loading UX.
 */
export async function readObdFromElm327(
  incidentId?: string
): Promise<TriageOBDData | null> {
  if (!pairing) return null;

  // Fresh incident → fresh vehicle condition (unless caller forced one).
  if (incidentId && incidentId !== lastReadIncidentId) {
    if (forcedState) {
      pairing.state = forcedState;
    } else {
      pairing.state = pickState();
    }
    lastReadIncidentId = incidentId;
  }

  await new Promise((r) => setTimeout(r, 250));
  return synthesizeReadings(pairing.state);
}

// ─────────────────────────────────────────────────────────────────────────
// Reading synthesizer — converts a VehicleState into plausible OBD-II PIDs
// ─────────────────────────────────────────────────────────────────────────

function jitter(value: number, percentNoise = 3): number {
  const delta = value * (percentNoise / 100) * (Math.random() * 2 - 1);
  return Number((value + delta).toFixed(2));
}

function synthesizeReadings(state: VehicleState): TriageOBDData {
  // Baseline = a parked, key-in-ACC 2015 Toyota Aqua in Colombo (28-32°C).
  // Engine is off so RPM/oil_pressure are 0; battery + brakes still readable.
  const r = {
    battery_voltage_v:      12.4,
    battery_temp_c:         30,
    battery_charge_percent: 75,
    battery_health_percent: 85,
    alternator_output_v:    0,    // engine off — no charging
    engine_temp_c:          32,
    coolant_temp_c:         34,
    engine_rpm:             0,
    oil_pressure_psi:       0,
    fuel_level_percent:     55,
    engine_load_percent:    0,
    ambient_temp_c:         29,
    brake_fluid_level_psi:  95,
    brake_pad_wear_mm:      7.0,
    brake_temp_c:           30,
  };

  // State-specific overrides — pull readings into a fault-indicating range
  // for the chosen condition. Magnitudes calibrated against the dataset that
  // trained the Tier-2 ML model (synthetic_telemetry_data.csv).
  switch (state) {
    case "BATTERY_DRAIN":
      r.battery_voltage_v      = 10.6;
      r.battery_charge_percent = 12;
      r.battery_health_percent = 78;
      break;
    case "BATTERY_AGED":
      r.battery_voltage_v      = 11.3;
      r.battery_charge_percent = 35;
      r.battery_health_percent = 55;
      r.battery_temp_c         = 38;
      break;
    case "STARTER_AGED":
      r.battery_voltage_v      = 11.9;       // battery OK
      r.battery_charge_percent = 65;
      r.battery_health_percent = 72;
      break;
    case "OVERHEATED":
      r.engine_temp_c   = 107;
      r.coolant_temp_c  = 103;
      r.oil_pressure_psi = 22;
      break;
    case "FUEL_LOW":
      r.fuel_level_percent = 2;
      break;
    case "BRAKE_WORN":
      r.brake_pad_wear_mm    = 2.5;
      r.brake_fluid_level_psi = 72;
      r.brake_temp_c          = 48;
      break;
    case "HEALTHY":
      // baseline is already healthy
      break;
  }

  return {
    battery_voltage_v:      jitter(r.battery_voltage_v,      2),
    battery_temp_c:         jitter(r.battery_temp_c,         4),
    battery_charge_percent: jitter(r.battery_charge_percent, 5),
    battery_health_percent: jitter(r.battery_health_percent, 2),
    alternator_output_v:    r.alternator_output_v,   // 0 stays 0
    engine_temp_c:          jitter(r.engine_temp_c,          3),
    coolant_temp_c:         jitter(r.coolant_temp_c,         3),
    engine_rpm:             r.engine_rpm,            // 0 stays 0
    oil_pressure_psi:       jitter(r.oil_pressure_psi,       8),
    fuel_level_percent:     jitter(r.fuel_level_percent,     4),
    engine_load_percent:    0,
    ambient_temp_c:         jitter(r.ambient_temp_c,         5),
    brake_fluid_level_psi:  jitter(r.brake_fluid_level_psi,  2),
    brake_pad_wear_mm:      jitter(r.brake_pad_wear_mm,      4),
    brake_temp_c:           jitter(r.brake_temp_c,           7),
    available:              true,
  };
}
