import type { ModelConfig, WhatIfInput } from "./types";

export function calculateImpactScore(input: WhatIfInput, model: ModelConfig) {
  const clf = input.lanesBlocked / Math.max(input.totalLanes, 1);
  const hourMult = model.hourMultiplier[String(input.hour)] ?? 0.5;
  const dayMult = model.dayMultiplier[String(input.dayOfWeek)] ?? 1.0;
  const tvf = Math.min(hourMult * dayMult, 1.0);
  const tf = Math.min(hourMult * dayMult, 1.0);
  const lf = model.roadLocationFactor[input.roadType] ?? 0.2;
  const isf = model.incidentSeverity[input.incidentType] ?? 0.5;

  const raw =
    model.weights.clf * clf +
    model.weights.tvf * tvf +
    model.weights.tf * tf +
    model.weights.lf * lf +
    model.weights.isf * isf;

  const score = Math.max(1, Math.min(10, Math.round(raw * 100) / 10));

  const capacity = model.roadCapacity[input.roadType] ?? 500;
  const arrivalRate = capacity * hourMult * dayMult;
  const remainingCapacity = capacity * (1 - clf);
  let queueKm = 0;
  let vhl = 0;
  let recoveryMin = 0;

  if (arrivalRate > remainingCapacity) {
    const excessRate = arrivalRate - remainingCapacity;
    const jamDensity = 120;
    const durationMin = 45;
    queueKm = Math.min((excessRate * (durationMin / 60)) / jamDensity, 15);
    const vehiclesAffected = excessRate * (durationMin / 60);
    vhl = vehiclesAffected * (durationMin / 4 / 60);
    recoveryMin = Math.min((queueKm * jamDensity) / ((capacity - arrivalRate) / 60), 180);
    if (recoveryMin < 0) recoveryMin = durationMin * 0.5;
  }

  let priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  if (score >= 8) priority = "CRITICAL";
  else if (score >= 5) priority = "HIGH";
  else if (score >= 3) priority = "MEDIUM";
  else priority = "LOW";

  return {
    score: Math.round(score * 10) / 10,
    priority,
    queueKm: Math.round(queueKm * 100) / 100,
    vhl: Math.round(vhl * 10) / 10,
    recoveryMin: Math.round(recoveryMin * 10) / 10,
    factors: { clf: Math.round(clf * 1000) / 1000, tvf: Math.round(tvf * 1000) / 1000, tf: Math.round(tf * 1000) / 1000, lf, isf },
  };
}
