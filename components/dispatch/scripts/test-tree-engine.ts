/**
 * Test harness for src/services/decision-tree-engine.ts
 *
 * Runs three representative scenarios through both Tier-1 and Tier-2 trees
 * and prints the predicted class + top-3 distribution. This is a smoke test —
 * no Postgres, no Express. Just verifies the JSON tree loads and traverses.
 *
 * Run:  npx ts-node scripts/test-tree-engine.ts
 */

import { runDecisionTree, TreeInput, TreeResult } from '../src/services/decision-tree-engine';

const NOT_ASKED = 'NOT_ASKED';

// ─── Scenario 1: classic dead-battery jump (Tier-1, no OBD) ───────────────
//
// Driver: car won't start, rapid-clicking sound, battery light on, parked
// outdoors overnight in coastal Colombo.
const scenario1: TreeInput = {
  Q1_intent:           'WONT_START',
  Q2_engine_start:     'NO_CRANK',
  Q2b_running_issue:   NOT_ASKED,
  Q3_sound:            'RAPID_CLICKING',
  Q3b_electrical:      'DIM_LIGHTS',
  Q4_noise_detail:     NOT_ASKED,
  Q7_overheat_detail:  NOT_ASKED,
  Q8_smoke_color:      NOT_ASKED,
  Q_brake_detail:      NOT_ASKED,
  Q_gear_detail:       NOT_ASKED,
  Q6_smells:           'NO_SMELL',
  Q5_lights:           ['BATTERY'],
  Q9_recent:           ['HARD_START'],
  location_type:       'COASTAL',
  recent_rain:         'NONE',
  parked_overnight:    'OUTDOOR',
  vehicle_age_bucket:  '8_15',
  last_fueled:         'WITHIN_WEEK',
};

// ─── Scenario 2: overheating in Colombo traffic (Tier-1) ──────────────────
const scenario2: TreeInput = {
  Q1_intent:           'ENGINE_PROBLEM',
  Q2_engine_start:     'STARTS_NORMAL',
  Q2b_running_issue:   'OVERHEATING',
  Q3_sound:            NOT_ASKED,
  Q3b_electrical:      NOT_ASKED,
  Q4_noise_detail:     NOT_ASKED,
  Q7_overheat_detail:  'TRAFFIC_ONLY',
  Q8_smoke_color:      NOT_ASKED,
  Q_brake_detail:      NOT_ASKED,
  Q_gear_detail:       NOT_ASKED,
  Q6_smells:           'NO_SMELL',
  Q5_lights:           ['TEMPERATURE'],
  Q9_recent:           ['OVERHEATING_BEFORE'],
  location_type:       'URBAN',
  recent_rain:         'NONE',
  parked_overnight:    'OUTDOOR',
  vehicle_age_bucket:  '3_7',
  last_fueled:         'TODAY_USUAL',
};

// ─── Scenario 3: brake squeal (Tier-1) ────────────────────────────────────
const scenario3: TreeInput = {
  Q1_intent:           'BRAKE_ISSUE',
  Q2_engine_start:     NOT_ASKED,
  Q2b_running_issue:   NOT_ASKED,
  Q3_sound:            NOT_ASKED,
  Q3b_electrical:      NOT_ASKED,
  Q4_noise_detail:     NOT_ASKED,
  Q7_overheat_detail:  NOT_ASKED,
  Q8_smoke_color:      NOT_ASKED,
  Q_brake_detail:      'SQUEALING',
  Q_gear_detail:       NOT_ASKED,
  Q6_smells:           'NO_SMELL',
  Q5_lights:           ['NONE'],
  Q9_recent:           ['UNUSUAL_NOISE'],
  location_type:       'URBAN',
  recent_rain:         'NONE',
  parked_overnight:    'INDOOR',
  vehicle_age_bucket:  '8_15',
  last_fueled:         'WITHIN_WEEK',
};

// ─── Scenario 1 with OBD attached → Tier-2 ────────────────────────────────
const scenario1_obd: TreeInput = {
  ...scenario1,
  // Realistic dead-battery OBD reading
  battery_voltage_v:        10.8,
  battery_temp_c:            27,
  battery_charge_percent:    18,
  battery_health_percent:    72,
  alternator_output_v:       12.0,
  engine_temp_c:             32,
  coolant_temp_c:            34,
  engine_rpm:                 0,
  oil_pressure_psi:           0,
  fuel_level_percent:        58,
  engine_load_percent:        0,
  ambient_temp_c:            29,
  brake_fluid_level_psi:    100,
  brake_pad_wear_mm:          7,
  brake_temp_c:              28,
};

function topN(probs: Record<string, number>, n = 3): Array<[string, number]> {
  return Object.entries(probs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

function summarise(label: string, result: TreeResult): void {
  console.log(`\n── ${label} ──`);
  console.log(`  predicted:    ${result.predictedClass}`);
  console.log(`  confidence:   ${result.confidence.toFixed(3)}`);
  console.log(`  entropy:      ${result.entropy.toFixed(3)}`);
  console.log(`  leaf samples: ${result.samplesAtLeaf}`);
  console.log(`  path depth:   ${result.pathDepth}`);
  console.log(`  top-3:`);
  for (const [cls, p] of topN(result.probabilities, 3)) {
    console.log(`    ${cls.padEnd(25)} ${(p * 100).toFixed(1).padStart(5)}%`);
  }
}

function main(): void {
  console.log('='.repeat(70));
  console.log('Decision Tree Engine — Smoke Test');
  console.log('='.repeat(70));

  // Tier-1 (questionnaire only)
  summarise('Scenario 1: Dead battery, Tier-1', runDecisionTree(scenario1, 1));
  summarise('Scenario 2: Overheating in traffic, Tier-1', runDecisionTree(scenario2, 1));
  summarise('Scenario 3: Brake squeal, Tier-1', runDecisionTree(scenario3, 1));

  // Tier-2 (questionnaire + OBD)
  summarise('Scenario 1 + OBD, Tier-2', runDecisionTree(scenario1_obd, 2));

  console.log('\n[OK] All scenarios traversed successfully.');
}

main();
