/**
 * ============================================================================
 * Diagnostic Triage Engine — adaptive form + ML decision tree
 * ============================================================================
 *
 * Replaces the hand-tuned multiplicative weight tables with the ML-derived
 * decision tree from ml/exported_tree_tier{1,2}.json. Same input/output
 * contract as before — `runTriageEngine(responses, obdData?)` returns a
 * `TriageResult` — but the internal logic is now data-driven.
 *
 * Tiering:
 *   - Tier 1 (QUESTIONNAIRE_ONLY): no `obdData` argument → tree 1
 *   - Tier 2 (OBD_ENHANCED):       `obdData.available === true` → tree 2
 *   - Tier 3 (BAYESIAN_LEARNED):   reserved for the upcoming Bayesian layer
 *
 * Fast-path short-circuit: if `responses.Q1_intent` is a fast-path intent,
 * the engine skips ML inference entirely and returns a deterministic result
 * with probability 1.0 on the corresponding service type.
 *
 * @module services/triage-engine
 * @author Janukshan Sivakumar - IT22635266
 */

import {
  TriageResponses, TriageResult, TriageTier,
  ServiceType, ServiceTypeProbabilities, SERVICE_TYPES,
  OBDData,
  FAST_PATH_INTENT_TO_SERVICE, isFastPathIntent,
} from '../types';
import { runDecisionTree, TreeInput } from './decision-tree-engine';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a TreeInput dict from the adaptive questionnaire responses
 * (and OBD data if provided). Field names match the trained tree's
 * feature_names exactly — see ml/generate_dataset.py.
 */
function toTreeInput(responses: TriageResponses, obd?: OBDData): TreeInput {
  const input: TreeInput = {
    // Single-select adaptive questions
    Q1_intent:           responses.Q1_intent,
    Q2_engine_start:     responses.Q2_engine_start,
    Q2b_running_issue:   responses.Q2b_running_issue,
    Q3_sound:            responses.Q3_sound,
    Q3b_electrical:      responses.Q3b_electrical,
    Q4_noise_detail:     responses.Q4_noise_detail,
    Q7_overheat_detail:  responses.Q7_overheat_detail,
    Q8_smoke_color:      responses.Q8_smoke_color,
    Q_brake_detail:      responses.Q_brake_detail,
    Q_gear_detail:       responses.Q_gear_detail,
    Q6_smells:           responses.Q6_smells,

    // Multi-selects (decision-tree-engine treats array values as set membership)
    Q5_lights:           responses.Q5_lights,
    Q9_recent:           responses.Q9_recent,

    // Sri Lankan context
    location_type:       responses.location_type,
    recent_rain:         responses.recent_rain,
    parked_overnight:    responses.parked_overnight,
    vehicle_age_bucket:  responses.vehicle_age_bucket,
    last_fueled:         responses.last_fueled,
  };

  if (obd?.available) {
    if (obd.battery_voltage_v        !== undefined) input.battery_voltage_v        = obd.battery_voltage_v;
    if (obd.battery_temp_c           !== undefined) input.battery_temp_c           = obd.battery_temp_c;
    if (obd.battery_charge_percent   !== undefined) input.battery_charge_percent   = obd.battery_charge_percent;
    if (obd.battery_health_percent   !== undefined) input.battery_health_percent   = obd.battery_health_percent;
    if (obd.alternator_output_v      !== undefined) input.alternator_output_v      = obd.alternator_output_v;
    if (obd.engine_temp_c            !== undefined) input.engine_temp_c            = obd.engine_temp_c;
    if (obd.coolant_temp_c           !== undefined) input.coolant_temp_c           = obd.coolant_temp_c;
    if (obd.engine_rpm               !== undefined) input.engine_rpm               = obd.engine_rpm;
    if (obd.oil_pressure_psi         !== undefined) input.oil_pressure_psi         = obd.oil_pressure_psi;
    if (obd.fuel_level_percent       !== undefined) input.fuel_level_percent       = obd.fuel_level_percent;
    if (obd.engine_load_percent      !== undefined) input.engine_load_percent      = obd.engine_load_percent;
    if (obd.ambient_temp_c           !== undefined) input.ambient_temp_c           = obd.ambient_temp_c;
    if (obd.brake_fluid_level_psi    !== undefined) input.brake_fluid_level_psi    = obd.brake_fluid_level_psi;
    if (obd.brake_pad_wear_mm        !== undefined) input.brake_pad_wear_mm        = obd.brake_pad_wear_mm;
    if (obd.brake_temp_c             !== undefined) input.brake_temp_c             = obd.brake_temp_c;
  }

  return input;
}

/** Initialise a probability distribution with 0 across every service type. */
function zeroProbabilities(): ServiceTypeProbabilities {
  const out = {} as ServiceTypeProbabilities;
  for (const st of SERVICE_TYPES) out[st] = 0;
  return out;
}

/**
 * Take the ML model's per-class probabilities (which only cover the 19 ML
 * classes) and project them into the full 29-class ServiceTypeProbabilities
 * shape that downstream ECM expects. Fast-path classes get 0.
 */
function expandToFullDistribution(
  modelProbs: Record<string, number>,
): ServiceTypeProbabilities {
  const out = zeroProbabilities();
  for (const st of SERVICE_TYPES) {
    if (modelProbs[st] !== undefined) out[st] = modelProbs[st];
  }
  // Re-normalise in case the model's classes didn't perfectly cover 1.0.
  const total = Object.values(out).reduce((s, p) => s + p, 0);
  if (total > 0) {
    for (const st of SERVICE_TYPES) out[st] /= total;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the diagnostic triage engine.
 *
 * Decision flow:
 *   1. If Q1_intent is a fast-path intent  → return a deterministic
 *      probability of 1.0 on the mapped ServiceType. No ML.
 *   2. Else, run the appropriate decision tree:
 *        - Tier 2 (OBD-enhanced) if `obdData?.available`
 *        - Tier 1 (questionnaire-only) otherwise
 *
 * The Bayesian layer (Tier 3) hooks in *after* this function in a future
 * commit by post-processing the returned probabilities.
 */
export function runTriageEngine(
  responses: TriageResponses,
  obdData?: OBDData,
): TriageResult {
  const startedAt = Date.now();

  // ── Fast-path short-circuit ──────────────────────────────────────────
  if (isFastPathIntent(responses.Q1_intent)) {
    const serviceType = FAST_PATH_INTENT_TO_SERVICE[responses.Q1_intent];
    const probs = zeroProbabilities();
    probs[serviceType] = 1.0;

    const result: TriageResult = {
      probabilities:         probs,
      predictedServiceType:  serviceType,
      confidence:            1.0,
      tier:                  'QUESTIONNAIRE_ONLY' as TriageTier,
      entropy:               0,
      obdDataUsed:           false,
      bayesianPriorsApplied: false,
    };

    logger.info('Triage fast-path dispatched', {
      Q1_intent: responses.Q1_intent,
      serviceType,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  }

  // ── ML path ──────────────────────────────────────────────────────────
  const tier: 1 | 2 = obdData?.available ? 2 : 1;
  const treeInput = toTreeInput(responses, obdData);
  const treeResult = runDecisionTree(treeInput, tier);

  const probabilities = expandToFullDistribution(treeResult.probabilities);

  // Pick argmax across the FULL distribution (not just the model's classes).
  // This is robust if expansion ever changes the ranking.
  let predictedServiceType: ServiceType = 'BATTERY_JUMP';
  let maxProb = -1;
  for (const st of SERVICE_TYPES) {
    if (probabilities[st] > maxProb) {
      maxProb = probabilities[st];
      predictedServiceType = st;
    }
  }

  const result: TriageResult = {
    probabilities,
    predictedServiceType,
    confidence:            treeResult.confidence,
    tier:                  tier === 2 ? 'OBD_ENHANCED' : 'QUESTIONNAIRE_ONLY',
    entropy:               treeResult.entropy,
    obdDataUsed:           tier === 2,
    bayesianPriorsApplied: false,
  };

  logger.info('Triage ML inference completed', {
    tier:                  result.tier,
    predictedServiceType:  result.predictedServiceType,
    confidence:            result.confidence.toFixed(3),
    entropy:               result.entropy.toFixed(3),
    leafSamples:           treeResult.samplesAtLeaf,
    pathDepth:             treeResult.pathDepth,
    elapsedMs:             Date.now() - startedAt,
    topThree:              topN(probabilities, 3),
  });

  return result;
}

function topN(probs: ServiceTypeProbabilities, n: number) {
  return Object.entries(probs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([type, prob]) => ({ type, probability: parseFloat(prob.toFixed(4)) }));
}
