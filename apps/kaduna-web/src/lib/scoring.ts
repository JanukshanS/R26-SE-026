import type { WhatIfInput } from "./types";

/**
 * In-browser copy of the deployed model,
 * components/geo-intelligence/src/impact_scoring.py (ImpactScoringModel.score
 * and predict_congestion). The what-if panel recomputes on every control move,
 * so it scores locally instead of round-tripping to the service.
 * scoring.test.ts holds this to the Python output; regenerate its fixture with
 * scripts/gen_scoring_fixture.py whenever the Python model changes.
 */

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const WEIGHTS = {
  clf: 0.25,
  tvf: 0.25,
  tf: 0.2,
  lf: 0.15,
  isf: 0.15,
};

const ROAD_CAPACITY_VPH: Record<string, number> = {
  motorway: 2200,
  trunk: 1800,
  primary: 1200,
  secondary: 800,
  tertiary: 600,
  residential: 300,
  living_street: 150,
  unclassified: 400,
};

const ROAD_PEAK_VC: Record<string, number> = {
  motorway: 0.95,
  trunk: 0.9,
  primary: 0.85,
  secondary: 0.7,
  tertiary: 0.55,
  residential: 0.4,
  living_street: 0.3,
  unclassified: 0.5,
};

const ROAD_LOCATION_FACTOR: Record<string, number> = {
  motorway: 1.0,
  trunk: 0.85,
  primary: 0.7,
  secondary: 0.5,
  tertiary: 0.35,
  residential: 0.15,
  living_street: 0.1,
  unclassified: 0.2,
};

const HOUR_VOLUME_MULTIPLIER = [
  0.05, 0.03, 0.02, 0.02, 0.05, 0.15, 0.45, 0.8, 1.0, 0.85, 0.6, 0.55,
  0.65, 0.6, 0.55, 0.65, 0.8, 0.95, 1.0, 0.75, 0.45, 0.3, 0.15, 0.1,
];

/** Mon=0 .. Sun=6. */
const DAY_MULTIPLIER = [1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 0.4];

const INCIDENT_SEVERITY: Record<string, number> = {
  flat_tire: 0.3,
  engine_failure: 0.7,
  accident_minor: 0.5,
  accident_major: 1.0,
  fuel_empty: 0.2,
  battery_dead: 0.3,
  overheating: 0.5,
};

/** Expected clearance time by incident type, minutes. */
export const INCIDENT_DURATION_MIN: Record<string, number> = {
  flat_tire: 30,
  engine_failure: 60,
  accident_minor: 45,
  accident_major: 120,
  fuel_empty: 20,
  battery_dead: 25,
  overheating: 40,
};

const DEFAULT_DURATION_MIN = 45;

export function clearanceMinutes(incidentType: string): number {
  return INCIDENT_DURATION_MIN[incidentType] ?? DEFAULT_DURATION_MIN;
}

/**
 * Python's round(x, digits) for non-negative x: correctly rounded on the
 * float's exact value, with exact ties going to the even digit. toFixed
 * matches it everywhere except those ties, where it rounds up.
 */
function pyRound(x: number, digits: number): number {
  const half = x * 2 ** (digits + 1);
  if (Number.isInteger(half) && half % 2 === 1) {
    const f = 10 ** digits;
    const lo = Math.floor(x * f);
    return (lo % 2 === 0 ? lo : lo + 1) / f;
  }
  return Number(x.toFixed(digits));
}

export function priorityFor(score: number): Priority {
  if (score >= 8) return "CRITICAL";
  if (score >= 5) return "HIGH";
  if (score >= 3) return "MEDIUM";
  return "LOW";
}

export function calculateImpactScore(input: WhatIfInput) {
  const { roadType, totalLanes, lanesBlocked, incidentType, hour, dayOfWeek } = input;
  const hourMult = HOUR_VOLUME_MULTIPLIER[hour] ?? 0.5;
  const dayMult = DAY_MULTIPLIER[dayOfWeek] ?? 1.0;

  const clf = totalLanes <= 0 ? 1.0 : Math.min(lanesBlocked / totalLanes, 1.0);
  const tvf = Math.min((ROAD_PEAK_VC[roadType] ?? 0.6) * hourMult * dayMult, 1.0);
  const tf = Math.min(hourMult * dayMult, 1.0);
  const lf = ROAD_LOCATION_FACTOR[roadType] ?? 0.2;
  const isf = INCIDENT_SEVERITY[incidentType] ?? 0.5;

  const raw =
    WEIGHTS.clf * clf +
    WEIGHTS.tvf * tvf +
    WEIGHTS.tf * tf +
    WEIGHTS.lf * lf +
    WEIGHTS.isf * isf;
  const score = Math.max(1.0, Math.min(10.0, pyRound(raw * 10, 1)));

  const capacity = ROAD_CAPACITY_VPH[roadType] ?? 500;
  const arrivalRate = capacity * hourMult * dayMult;
  const remainingCapacity = capacity * (1 - lanesBlocked / Math.max(totalLanes, 1));
  const durationMin = clearanceMinutes(incidentType);

  let queueKm = 0;
  let vhl = 0;
  let recoveryMin = 0;
  if (arrivalRate > remainingCapacity) {
    const excessRate = arrivalRate - remainingCapacity;
    const jamDensity = 120;
    queueKm = Math.min((excessRate * (durationMin / 60)) / jamDensity, 15);
    const vehiclesAffected = excessRate * (durationMin / 60);
    vhl = vehiclesAffected * (durationMin / 4 / 60);
    recoveryMin =
      arrivalRate < capacity
        ? (queueKm * jamDensity) / ((capacity - arrivalRate) / 60)
        : durationMin * 0.5;
  }

  return {
    score,
    priority: priorityFor(score),
    queueKm: pyRound(queueKm, 2),
    vhl: pyRound(vhl, 1),
    recoveryMin: pyRound(Math.min(recoveryMin, 180), 1),
  };
}
