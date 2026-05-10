/**
 * ============================================================================
 * Diagnostic Triage Engine — Probability Distribution Generator
 * ============================================================================
 * 
 * Core algorithm that transforms questionnaire responses (Q1-Q8) into a
 * probability distribution over 9 service types. This is the heart of SO1.
 * 
 * Three-tier system:
 *   Tier 1: Questionnaire-only (baseline)
 *   Tier 2: OBD-enhanced (Phase 6)
 *   Tier 3: Bayesian-learned (Phase 7)
 * 
 * Algorithm approach:
 *   1. Start with uniform prior over 9 service types
 *   2. Each answer applies multiplicative weight adjustments
 *   3. Normalize to ensure probabilities sum to 1.0
 *   4. Calculate confidence (1 - normalized entropy)
 * 
 * @module services/triage-engine
 * @author Janukshan Sivakumar - IT22635266
 */

import {
  ServiceType, SERVICE_TYPES, TriageResponses, TriageResult,
  ServiceTypeProbabilities, TriageTier, OBDData,
  DashboardLamp, EngineSound,
} from '../types';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────
// Weight Tables — Expert-knowledge-based diagnostic weights
// ─────────────────────────────────────────────────────────

/**
 * Q1: Visible Damage weights
 * Crash damage strongly suggests towing; no damage shifts toward electrical/fuel
 */
const VISIBLE_DAMAGE_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  CRASH: {
    TOW_HEAVY: 4.0, TOW_LIGHT: 3.0, MECHANIC_FIX: 1.5,
    BATTERY_JUMP: 0.3, BATTERY_REPLACE: 0.3, STARTER_MOTOR: 0.5,
    FUEL_DELIVERY: 0.1, FLAT_TIRE: 0.8, LOCKOUT: 0.1,
  },
  MINOR: {
    TOW_LIGHT: 1.5, MECHANIC_FIX: 1.8, FLAT_TIRE: 1.5,
    BATTERY_JUMP: 0.8, BATTERY_REPLACE: 0.8, STARTER_MOTOR: 0.9,
    FUEL_DELIVERY: 0.5, TOW_HEAVY: 0.8, LOCKOUT: 0.3,
  },
  NONE: {
    BATTERY_JUMP: 1.5, BATTERY_REPLACE: 1.3, STARTER_MOTOR: 1.3,
    FUEL_DELIVERY: 1.5, FLAT_TIRE: 1.2, LOCKOUT: 1.5,
    MECHANIC_FIX: 1.0, TOW_LIGHT: 0.6, TOW_HEAVY: 0.3,
  },
};

/**
 * Q2: Can Start Engine weights
 * Engine won't start → battery/starter/fuel; runs → flat tire/lockout/mechanic
 */
const ENGINE_START_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  YES: {
    FLAT_TIRE: 2.5, LOCKOUT: 2.0, MECHANIC_FIX: 1.8,
    BATTERY_JUMP: 0.2, BATTERY_REPLACE: 0.2, STARTER_MOTOR: 0.1,
    FUEL_DELIVERY: 0.3, TOW_LIGHT: 0.8, TOW_HEAVY: 0.5,
  },
  NO: {
    BATTERY_JUMP: 2.5, BATTERY_REPLACE: 2.0, STARTER_MOTOR: 2.5,
    FUEL_DELIVERY: 1.5, MECHANIC_FIX: 1.5, TOW_LIGHT: 1.3,
    TOW_HEAVY: 1.0, FLAT_TIRE: 0.3, LOCKOUT: 0.1,
  },
  PARTIAL: {
    STARTER_MOTOR: 2.0, BATTERY_JUMP: 1.8, FUEL_DELIVERY: 1.5,
    MECHANIC_FIX: 2.0, BATTERY_REPLACE: 1.5, TOW_LIGHT: 1.0,
    TOW_HEAVY: 0.7, FLAT_TIRE: 0.3, LOCKOUT: 0.1,
  },
};

/**
 * Q3: Engine Sound weights
 * Each sound pattern maps to specific fault categories
 */
const ENGINE_SOUND_WEIGHTS: Record<EngineSound, Partial<Record<ServiceType, number>>> = {
  RAPID_CLICKING: {
    BATTERY_JUMP: 4.0, BATTERY_REPLACE: 2.5, STARTER_MOTOR: 1.2,
    MECHANIC_FIX: 0.5, FUEL_DELIVERY: 0.2,
  },
  SINGLE_CLICK: {
    STARTER_MOTOR: 4.0, BATTERY_JUMP: 1.5, BATTERY_REPLACE: 1.2,
    MECHANIC_FIX: 1.0, TOW_LIGHT: 1.5,
  },
  GRINDING_WHIRRING: {
    STARTER_MOTOR: 3.0, MECHANIC_FIX: 2.5, TOW_LIGHT: 2.0,
    TOW_HEAVY: 1.5, BATTERY_JUMP: 0.5,
  },
  CRANKS_NO_START: {
    FUEL_DELIVERY: 3.0, MECHANIC_FIX: 2.5, STARTER_MOTOR: 1.0,
    TOW_LIGHT: 1.5, BATTERY_JUMP: 0.5,
  },
  NO_SOUND: {
    BATTERY_JUMP: 3.5, BATTERY_REPLACE: 3.0, STARTER_MOTOR: 1.5,
    MECHANIC_FIX: 0.8, TOW_LIGHT: 1.0,
  },
};

/**
 * Q4: Dashboard Warning Lamp weights
 * Each lit lamp shifts probabilities toward associated systems
 */
const DASHBOARD_LAMP_WEIGHTS: Record<DashboardLamp, Partial<Record<ServiceType, number>>> = {
  BATTERY: {
    BATTERY_JUMP: 3.0, BATTERY_REPLACE: 2.5, STARTER_MOTOR: 1.3, MECHANIC_FIX: 0.8,
  },
  CHECK_ENGINE: {
    MECHANIC_FIX: 2.5, TOW_LIGHT: 1.3, FUEL_DELIVERY: 0.8, STARTER_MOTOR: 0.9,
  },
  OIL_PRESSURE: {
    MECHANIC_FIX: 2.5, TOW_LIGHT: 2.0, TOW_HEAVY: 1.5,
  },
  TEMPERATURE: {
    MECHANIC_FIX: 2.5, TOW_LIGHT: 2.0, TOW_HEAVY: 1.3,
  },
  ABS: {
    MECHANIC_FIX: 1.8, TOW_LIGHT: 1.2,
  },
  BRAKE: {
    MECHANIC_FIX: 2.0, TOW_LIGHT: 2.0, TOW_HEAVY: 1.5,
  },
  AIRBAG: {
    MECHANIC_FIX: 1.5, TOW_LIGHT: 1.2,
  },
  TIRE_PRESSURE: {
    FLAT_TIRE: 3.5, MECHANIC_FIX: 1.0,
  },
  TRANSMISSION: {
    TOW_LIGHT: 2.5, TOW_HEAVY: 2.0, MECHANIC_FIX: 2.0,
  },
};

/**
 * Q5: Fluid Leaking weights
 */
const FLUID_LEAK_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  YES_COOLANT: { MECHANIC_FIX: 2.0, TOW_LIGHT: 2.5, TOW_HEAVY: 1.5 },
  YES_OIL: { MECHANIC_FIX: 2.0, TOW_LIGHT: 2.0, TOW_HEAVY: 1.5 },
  YES_FUEL: { FUEL_DELIVERY: 1.5, TOW_LIGHT: 2.5, TOW_HEAVY: 2.0, MECHANIC_FIX: 1.5 },
  YES_UNKNOWN: { MECHANIC_FIX: 1.5, TOW_LIGHT: 1.8, TOW_HEAVY: 1.3 },
  NO: {}, // No adjustment
};

/**
 * Q6: Problem Onset weights
 * Sudden problems suggest acute failures; gradual suggests wear
 */
const PROBLEM_ONSET_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  JUST_NOW: {
    BATTERY_JUMP: 1.5, FLAT_TIRE: 1.8, LOCKOUT: 1.5, FUEL_DELIVERY: 1.3,
  },
  TODAY: {
    BATTERY_JUMP: 1.2, MECHANIC_FIX: 1.3, STARTER_MOTOR: 1.2,
  },
  GRADUAL: {
    MECHANIC_FIX: 2.0, BATTERY_REPLACE: 1.8, STARTER_MOTOR: 1.5,
    TOW_LIGHT: 1.3, BATTERY_JUMP: 0.7,
  },
};

/**
 * Q7: Unusual Smells weights
 */
const SMELL_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  BURNING: {
    MECHANIC_FIX: 2.5, TOW_LIGHT: 2.0, TOW_HEAVY: 1.5,
    BATTERY_REPLACE: 1.5, STARTER_MOTOR: 1.3,
  },
  FUEL: {
    FUEL_DELIVERY: 2.5, MECHANIC_FIX: 1.8, TOW_LIGHT: 1.5,
  },
  ROTTEN_EGGS: {
    BATTERY_REPLACE: 2.5, MECHANIC_FIX: 2.0, TOW_LIGHT: 1.3,
  },
  NONE: {}, // No adjustment
};

/**
 * Q8: Recent Warning Signs weights
 */
const WARNING_SIGN_WEIGHTS: Record<string, Partial<Record<ServiceType, number>>> = {
  FLICKERING_LIGHTS: {
    BATTERY_JUMP: 2.0, BATTERY_REPLACE: 2.5, STARTER_MOTOR: 1.3, MECHANIC_FIX: 1.2,
  },
  POWER_LOSS: {
    MECHANIC_FIX: 2.0, FUEL_DELIVERY: 1.5, TOW_LIGHT: 1.5, STARTER_MOTOR: 1.3,
  },
  UNUSUAL_NOISES: {
    MECHANIC_FIX: 2.0, STARTER_MOTOR: 1.5, TOW_LIGHT: 1.3, TOW_HEAVY: 1.0,
  },
  NONE: {}, // No adjustment
};


// ─────────────────────────────────────────────────────────
// Core Engine
// ─────────────────────────────────────────────────────────

/**
 * Initialize a uniform probability distribution over all service types.
 * Each type starts with equal probability: 1/9 ≈ 0.111
 */
function initializeUniformPrior(): ServiceTypeProbabilities {
  const prob = {} as ServiceTypeProbabilities;
  const uniformValue = 1.0 / SERVICE_TYPES.length;
  for (const st of SERVICE_TYPES) {
    prob[st] = uniformValue;
  }
  return prob;
}

/**
 * Apply multiplicative weight adjustments from a weight table.
 * For each service type with a weight, multiply the current probability.
 * Types without explicit weights remain unchanged.
 */
function applyWeights(
  probabilities: ServiceTypeProbabilities,
  weights: Partial<Record<ServiceType, number>>
): ServiceTypeProbabilities {
  const result = { ...probabilities };
  for (const [serviceType, weight] of Object.entries(weights)) {
    if (weight !== undefined && result[serviceType as ServiceType] !== undefined) {
      result[serviceType as ServiceType] *= weight;
    }
  }
  return result;
}

/**
 * Normalize probabilities so they sum to 1.0.
 * Applies Laplace smoothing (minimum floor) to prevent any type from reaching 0.
 */
function normalize(probabilities: ServiceTypeProbabilities): ServiceTypeProbabilities {
  const FLOOR = 0.005; // Minimum probability to prevent zero-out
  const result = { ...probabilities };

  // Apply floor
  for (const st of SERVICE_TYPES) {
    if (result[st] < FLOOR) result[st] = FLOOR;
  }

  // Normalize to sum = 1.0
  const total = SERVICE_TYPES.reduce((sum, st) => sum + result[st], 0);
  for (const st of SERVICE_TYPES) {
    result[st] = result[st] / total;
  }

  return result;
}

/**
 * Calculate Shannon entropy of the distribution.
 * Lower entropy = more certain diagnosis.
 * Max entropy for 9 types = log2(9) ≈ 3.17
 */
function calculateEntropy(probabilities: ServiceTypeProbabilities): number {
  let entropy = 0;
  for (const st of SERVICE_TYPES) {
    const p = probabilities[st];
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Calculate confidence as 1 - (entropy / maxEntropy).
 * Range: [0, 1] where 1 = perfectly certain.
 */
function calculateConfidence(entropy: number): number {
  const maxEntropy = Math.log2(SERVICE_TYPES.length); // log2(9) ≈ 3.17
  return Math.max(0, 1 - (entropy / maxEntropy));
}

/**
 * Find the service type with highest probability.
 */
function getPredictedServiceType(probabilities: ServiceTypeProbabilities): ServiceType {
  let maxProb = 0;
  let predicted: ServiceType = 'MECHANIC_FIX';
  for (const st of SERVICE_TYPES) {
    if (probabilities[st] > maxProb) {
      maxProb = probabilities[st];
      predicted = st;
    }
  }
  return predicted;
}


// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

/**
 * Run the Diagnostic Triage Engine (Tier 1: Questionnaire-Only).
 * 
 * Takes the 8 questionnaire responses and produces a probability
 * distribution over 9 service types.
 * 
 * Algorithm:
 * 1. Start with uniform prior (1/9 each)
 * 2. Q1 (damage) → apply weights
 * 3. Q2 (engine start) → apply weights
 * 4. Q3 (sound, conditional) → apply weights if applicable
 * 5. Q4 (dashboard lamps) → apply weights for each selected lamp
 * 6. Q5 (fluid leak) → apply weights if provided
 * 7. Q6 (onset) → apply weights
 * 8. Q7 (smells) → apply weights
 * 9. Q8 (warnings) → apply weights for each selected warning
 * 10. Normalize → calculate entropy → determine confidence
 */
export function runTriageEngine(responses: TriageResponses): TriageResult {
  const startTime = Date.now();

  // Step 1: Uniform prior
  let probs = initializeUniformPrior();

  // Step 2: Q1 — Visible damage
  probs = applyWeights(probs, VISIBLE_DAMAGE_WEIGHTS[responses.visibleDamage] || {});

  // Step 3: Q2 — Can start engine
  probs = applyWeights(probs, ENGINE_START_WEIGHTS[responses.canStartEngine] || {});

  // Step 4: Q3 — Engine sound (conditional on Q2 != YES)
  if (responses.engineSound && responses.canStartEngine !== 'YES') {
    probs = applyWeights(probs, ENGINE_SOUND_WEIGHTS[responses.engineSound] || {});
  }

  // Step 5: Q4 — Dashboard lamps (multi-select: apply each lamp's weights)
  for (const lamp of responses.dashboardLamps) {
    probs = applyWeights(probs, DASHBOARD_LAMP_WEIGHTS[lamp] || {});
  }

  // Step 6: Q5 — Fluid leaking (optional)
  if (responses.fluidLeaking) {
    probs = applyWeights(probs, FLUID_LEAK_WEIGHTS[responses.fluidLeaking] || {});
  }

  // Step 7: Q6 — Problem onset
  probs = applyWeights(probs, PROBLEM_ONSET_WEIGHTS[responses.problemOnset] || {});

  // Step 8: Q7 — Unusual smells
  probs = applyWeights(probs, SMELL_WEIGHTS[responses.unusualSmells] || {});

  // Step 9: Q8 — Recent warnings (multi-select)
  for (const warning of responses.recentWarnings) {
    probs = applyWeights(probs, WARNING_SIGN_WEIGHTS[warning] || {});
  }

  // Step 10: Normalize and compute metrics
  probs = normalize(probs);
  const entropy = calculateEntropy(probs);
  const confidence = calculateConfidence(entropy);
  const predictedServiceType = getPredictedServiceType(probs);

  const result: TriageResult = {
    probabilities: probs,
    predictedServiceType,
    confidence,
    tier: 'QUESTIONNAIRE_ONLY' as TriageTier,
    entropy,
    obdDataUsed: false,
    bayesianPriorsApplied: false,
  };

  const elapsed = Date.now() - startTime;

  logger.info('Triage engine completed', {
    tier: result.tier,
    predictedServiceType,
    confidence: confidence.toFixed(3),
    entropy: entropy.toFixed(3),
    elapsedMs: elapsed,
    topProbabilities: getTopN(probs, 3),
  });

  return result;
}

/**
 * Get top N service types by probability (for logging).
 */
function getTopN(probs: ServiceTypeProbabilities, n: number) {
  return Object.entries(probs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([type, prob]) => ({ type, probability: parseFloat(prob.toFixed(4)) }));
}
