/**
 * ============================================================================
 * OBD-II trouble codes → dispatchable ServiceType
 * ============================================================================
 *
 * WHY THIS EXISTS. Everything else the triage engine sees is indirect. The
 * questionnaire is the driver's *interpretation* of a symptom ("grinding
 * noise"), and live PIDs are sensor values a fault has to be *inferred* from.
 * A stored trouble code is neither: it is the ECU's own conclusion about a
 * specific fault it already detected and confirmed. P0301 is not "cylinder 1
 * might be misfiring" — it is the engine computer stating it counted the
 * misfires and set a code.
 *
 * That makes a code the strongest single piece of evidence available about
 * WHICH provider to send, which is the only question this component answers.
 *
 * WHY THIS IS A HAND-WRITTEN TABLE AND NOT A MODEL, and why it is here rather
 * than fetched from predictive-maintenance: the mapping decides which
 * provider is dispatched, so it must be inspectable and stable, and dispatch
 * must not gain a runtime dependency on another service inside its critical
 * path. Herath's `fault_catalogue.py` maps codes to HIS four wear components
 * (engine/brake/tire/battery); this maps them to OUR 19 dispatchable service
 * types. Related problem, different target — a shared table would fit neither.
 *
 * WHY IT REWEIGHTS RATHER THAN OVERRIDES. Two reasons, both real:
 *
 *   1. A code is often the CONSEQUENCE of the actual fault, not the fault. A
 *      P0420 (catalyst below threshold) is usually downstream of an untreated
 *      misfire — dispatching a catalytic-converter job would be treating the
 *      symptom. Those codes are catalogued at `weak` deliberately.
 *   2. Codes are set by the powertrain and emissions systems. Generic mode 03
 *      says almost nothing about brakes, and nothing at all about tyres,
 *      lockouts or an empty tank. Letting a code override the questionnaire
 *      would make the covered faults sharper at the cost of the uncovered
 *      ones being confidently wrong.
 *
 * COVERAGE IS HONEST, NOT COMPLETE. There are thousands of manufacturer
 * codes. This holds the common generic ones plus family fallbacks, so an
 * uncatalogued code still resolves to something defensible instead of being
 * silently dropped.
 *
 * @module constants/dtc-mapping
 * @author Janukshan Sivakumar - IT22635266
 */

import { ServiceType } from '../types';

/**
 * How strongly a code implies its service type(s).
 *
 *   strong   — the code names this failure directly (P0562 → charging fault)
 *   moderate — the code narrows to a system, not a part (P0715 → transmission)
 *   weak     — the code is usually a downstream effect, or has many causes
 */
export type DtcStrength = 'strong' | 'moderate' | 'weak';

/** As reported by the adapter. A pending code failed one drive cycle without
 *  confirming, so it is a weaker claim than a confirmed one. */
export type DtcStatus = 'confirmed' | 'pending' | 'permanent';

export interface DtcEntry {
  /** Service types this code points at. More than one when the code narrows
   *  to a pair that need the same provider skillset anyway. */
  services: ServiceType[];
  strength: DtcStrength;
  /** Plain-language fault name, surfaced to the provider on the job screen. */
  title: string;
}

/**
 * How much of the final distribution the code evidence is allowed to claim.
 * These are mixture weights, matching the convex-combination idiom the
 * Bayesian layer already uses (`blendPriorWithTree`), so the two compose
 * predictably rather than one silently swamping the other.
 */
const STRENGTH_WEIGHT: Record<DtcStrength, number> = {
  strong:   0.55,
  moderate: 0.35,
  weak:     0.18,
};

/** A pending code has not confirmed yet, so it gets half the pull. */
const PENDING_MULTIPLIER = 0.5;

/**
 * Hard ceiling on the code evidence's share, applied after combining every
 * code on the vehicle. Guarantees the questionnaire and OBD sensors always
 * retain a meaningful minority stake — this layer sharpens the diagnosis, it
 * never replaces it.
 */
export const MAX_DTC_WEIGHT = 0.6;

// ─────────────────────────────────────────────────────────────────────────
// The catalogue
// ─────────────────────────────────────────────────────────────────────────

/** P0301-P0308 differ only by cylinder number. */
function misfire(cylinder: number): [string, DtcEntry] {
  return [
    `P030${cylinder}`,
    {
      services: ['IGNITION_SYSTEM'],
      strength: 'strong',
      title: `Cylinder ${cylinder} misfire`,
    },
  ];
}

export const DTC_CATALOGUE: Record<string, DtcEntry> = {
  // ── Charging system ──────────────────────────────────────────────────
  // These matter disproportionately: a driver reads "battery" and assumes a
  // jump start, when a charging fault means the alternator is the job.
  P0560: { services: ['ALTERNATOR_ISSUE', 'BATTERY_REPLACE'], strength: 'moderate', title: 'System voltage malfunction' },
  P0562: { services: ['ALTERNATOR_ISSUE', 'BATTERY_REPLACE'], strength: 'strong',   title: 'Charging system voltage too low' },
  P0563: { services: ['ALTERNATOR_ISSUE'],                    strength: 'strong',   title: 'Charging system voltage too high' },
  P0620: { services: ['ALTERNATOR_ISSUE'],                    strength: 'strong',   title: 'Generator control circuit fault' },
  P0621: { services: ['ALTERNATOR_ISSUE'],                    strength: 'strong',   title: 'Generator lamp control circuit' },
  P0622: { services: ['ALTERNATOR_ISSUE'],                    strength: 'strong',   title: 'Generator field control circuit' },

  // ── Starting ─────────────────────────────────────────────────────────
  P0615: { services: ['STARTER_MOTOR'], strength: 'strong', title: 'Starter relay circuit' },
  P0616: { services: ['STARTER_MOTOR'], strength: 'strong', title: 'Starter relay circuit low' },
  P0617: { services: ['STARTER_MOTOR'], strength: 'strong', title: 'Starter relay circuit high' },

  // ── Misfire / ignition ───────────────────────────────────────────────
  P0300: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Random or multiple cylinder misfire' },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(misfire)),
  P0350: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Ignition coil primary/secondary circuit' },
  P0351: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Ignition coil A circuit' },
  P0352: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Ignition coil B circuit' },
  P0353: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Ignition coil C circuit' },
  P0354: { services: ['IGNITION_SYSTEM'], strength: 'strong', title: 'Ignition coil D circuit' },

  // ── Fuel delivery ────────────────────────────────────────────────────
  P0087: { services: ['FUEL_FILTER_CLOGGED', 'FUEL_PUMP'], strength: 'strong',   title: 'Fuel rail pressure too low' },
  P0230: { services: ['FUEL_PUMP'],                        strength: 'strong',   title: 'Fuel pump primary circuit' },
  P0231: { services: ['FUEL_PUMP'],                        strength: 'strong',   title: 'Fuel pump secondary circuit low' },
  P0232: { services: ['FUEL_PUMP'],                        strength: 'strong',   title: 'Fuel pump secondary circuit high' },
  P0233: { services: ['FUEL_PUMP'],                        strength: 'moderate', title: 'Fuel pump secondary circuit intermittent' },
  // Lean/rich have many causes (vacuum leak, MAF, injector, O2 sensor), so a
  // filter is only one candidate among several — weak on purpose.
  P0171: { services: ['FUEL_FILTER_CLOGGED'], strength: 'weak', title: 'Engine running lean (bank 1)' },
  P0172: { services: ['FUEL_FILTER_CLOGGED'], strength: 'weak', title: 'Engine running rich (bank 1)' },
  P0174: { services: ['FUEL_FILTER_CLOGGED'], strength: 'weak', title: 'Engine running lean (bank 2)' },
  P0175: { services: ['FUEL_FILTER_CLOGGED'], strength: 'weak', title: 'Engine running rich (bank 2)' },

  // ── Cooling ──────────────────────────────────────────────────────────
  P0217: { services: ['ENGINE_OVERHEAT_SEVERE'], strength: 'strong',   title: 'Engine overheating' },
  P0128: { services: ['COOLANT_LOW'],            strength: 'moderate', title: 'Coolant below thermostat regulating temperature' },
  P0480: { services: ['RADIATOR_FAN_ISSUE'],     strength: 'strong',   title: 'Cooling fan 1 control circuit' },
  P0481: { services: ['RADIATOR_FAN_ISSUE'],     strength: 'strong',   title: 'Cooling fan 2 control circuit' },
  P0691: { services: ['RADIATOR_FAN_ISSUE'],     strength: 'strong',   title: 'Cooling fan 1 control circuit low' },
  P0692: { services: ['RADIATOR_FAN_ISSUE'],     strength: 'strong',   title: 'Cooling fan 1 control circuit high' },
  P0115: { services: ['COOLANT_LOW'],            strength: 'weak',     title: 'Coolant temperature sensor circuit' },
  P0116: { services: ['COOLANT_LOW'],            strength: 'weak',     title: 'Coolant temperature sensor range' },
  P0117: { services: ['COOLANT_LOW'],            strength: 'weak',     title: 'Coolant temperature sensor low' },
  P0118: { services: ['COOLANT_LOW'],            strength: 'weak',     title: 'Coolant temperature sensor high' },

  // ── Transmission / clutch ────────────────────────────────────────────
  P0700: { services: ['TRANSMISSION_ISSUE'],                strength: 'strong',   title: 'Transmission control system fault' },
  P0701: { services: ['TRANSMISSION_ISSUE'],                strength: 'strong',   title: 'Transmission control system range' },
  P0702: { services: ['TRANSMISSION_ISSUE'],                strength: 'strong',   title: 'Transmission control system electrical' },
  P0715: { services: ['TRANSMISSION_ISSUE'],                strength: 'moderate', title: 'Input/turbine speed sensor circuit' },
  P0716: { services: ['TRANSMISSION_ISSUE'],                strength: 'moderate', title: 'Input/turbine speed sensor range' },
  P0720: { services: ['TRANSMISSION_ISSUE'],                strength: 'moderate', title: 'Output speed sensor circuit' },
  P0740: { services: ['CLUTCH_WORN', 'TRANSMISSION_ISSUE'], strength: 'moderate', title: 'Torque converter clutch circuit' },
  P0741: { services: ['CLUTCH_WORN', 'TRANSMISSION_ISSUE'], strength: 'moderate', title: 'Torque converter clutch stuck off' },

  // ── Brakes (C-codes) ─────────────────────────────────────────────────
  // A wheel-speed-sensor fault disables ABS. That is a braking-system defect
  // needing attention, not worn pads — mapping it to BRAKE_PAD_WORN would
  // send someone with the wrong parts.
  C0035: { services: ['BRAKE_FAILURE'], strength: 'moderate', title: 'Left front wheel speed sensor' },
  C0040: { services: ['BRAKE_FAILURE'], strength: 'moderate', title: 'Right front wheel speed sensor' },
  C0045: { services: ['BRAKE_FAILURE'], strength: 'moderate', title: 'Left rear wheel speed sensor' },
  C0050: { services: ['BRAKE_FAILURE'], strength: 'moderate', title: 'Right rear wheel speed sensor' },
  C0265: { services: ['BRAKE_FAILURE'], strength: 'moderate', title: 'EBCM relay circuit' },

  // ── Consequence codes ────────────────────────────────────────────────
  // Catalyst efficiency is nearly always downstream of an untreated misfire
  // or mixture fault. It points at the ROOT (ignition), weakly.
  P0420: { services: ['IGNITION_SYSTEM'], strength: 'weak', title: 'Catalyst below efficiency threshold (bank 1)' },
  P0430: { services: ['IGNITION_SYSTEM'], strength: 'weak', title: 'Catalyst below efficiency threshold (bank 2)' },
};

/**
 * Family fallbacks, most specific prefix first. An uncatalogued but real code
 * still resolves to a system, so a dashboard light never produces silence.
 * All `weak`/`moderate` — a family says which subsystem, never which part.
 */
const FAMILIES: { prefix: string; entry: DtcEntry }[] = [
  { prefix: 'P030', entry: { services: ['IGNITION_SYSTEM'],                  strength: 'moderate', title: 'Engine misfire' } },
  { prefix: 'P035', entry: { services: ['IGNITION_SYSTEM'],                  strength: 'moderate', title: 'Ignition coil circuit fault' } },
  { prefix: 'P023', entry: { services: ['FUEL_PUMP'],                        strength: 'moderate', title: 'Fuel pump circuit fault' } },
  { prefix: 'P056', entry: { services: ['ALTERNATOR_ISSUE'],                 strength: 'moderate', title: 'Charging system fault' } },
  { prefix: 'P062', entry: { services: ['ALTERNATOR_ISSUE'],                 strength: 'moderate', title: 'Generator control fault' } },
  { prefix: 'P061', entry: { services: ['STARTER_MOTOR'],                    strength: 'weak',     title: 'Control module output circuit fault' } },
  { prefix: 'P07',  entry: { services: ['TRANSMISSION_ISSUE'],               strength: 'moderate', title: 'Transmission fault' } },
  { prefix: 'P08',  entry: { services: ['TRANSMISSION_ISSUE'],               strength: 'moderate', title: 'Transmission fault' } },
  { prefix: 'P09',  entry: { services: ['TRANSMISSION_ISSUE'],               strength: 'moderate', title: 'Transmission fault' } },
  { prefix: 'C',    entry: { services: ['BRAKE_FAILURE'],                    strength: 'weak',     title: 'Chassis fault, often ABS related' } },
  // Network faults between control units are a classic wet-weather symptom in
  // Sri Lankan conditions, which is the fault class ELECTRICAL_FAULT_RAIN covers.
  { prefix: 'U',    entry: { services: ['ELECTRICAL_FAULT_RAIN'],            strength: 'weak',     title: 'Network communication fault' } },
];

/** Shape of a code as it arrives from the phone. */
export interface ReportedDtc {
  code: string;
  status?: DtcStatus;
}

/**
 * Everything known about a code — exact entry first, then its family.
 * `null` for anything that is not a well-formed trouble code at all.
 */
export function lookupDtc(code: string): (DtcEntry & { isGeneric: boolean }) | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();

  const exact = DTC_CATALOGUE[key];
  if (exact) return { ...exact, isGeneric: false };

  // P/C/B/U followed by four alphanumerics is the wire format.
  if (key.length < 5 || !'PCBU'.includes(key[0]) || !/^[0-9A-Z]+$/.test(key.slice(1))) {
    return null;
  }

  for (const { prefix, entry } of FAMILIES) {
    if (key.startsWith(prefix)) return { ...entry, isGeneric: true };
  }
  return null;
}

/**
 * The evidence a set of codes contributes, as a distribution over service
 * types plus the weight it should carry.
 *
 * `weight` is 0 when nothing resolved, which makes the caller a no-op — a
 * vehicle with no codes, or only uncatalogued ones, is left exactly as the
 * decision tree found it.
 */
export function dtcEvidence(codes: ReportedDtc[]): {
  weight: number;
  scores: Partial<Record<ServiceType, number>>;
  matched: { code: string; title: string; services: ServiceType[]; isGeneric: boolean }[];
} {
  const scores: Partial<Record<ServiceType, number>> = {};
  const matched: { code: string; title: string; services: ServiceType[]; isGeneric: boolean }[] = [];
  let weight = 0;

  for (const reported of codes ?? []) {
    const info = lookupDtc(reported.code);
    if (!info) continue;

    const isPending = reported.status === 'pending';
    const w = STRENGTH_WEIGHT[info.strength] * (isPending ? PENDING_MULTIPLIER : 1);

    // The overall weight is the strongest single code, not the sum: five weak
    // codes are not more diagnostic than one confirmed strong one, and summing
    // would let a cluster of minor faults quietly override the questionnaire.
    weight = Math.max(weight, w);

    // Within the evidence distribution, every matching code contributes, so
    // two codes pointing at the same service type reinforce each other.
    for (const service of info.services) {
      scores[service] = (scores[service] ?? 0) + w / info.services.length;
    }

    matched.push({
      code: reported.code.trim().toUpperCase(),
      title: info.title,
      services: info.services,
      isGeneric: info.isGeneric,
    });
  }

  return { weight: Math.min(weight, MAX_DTC_WEIGHT), scores, matched };
}
