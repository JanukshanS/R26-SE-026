/**
 * ============================================================================
 * Symptom-Key — canonical hash tests
 * ============================================================================
 *
 * Symptom keys are the join column between incidents and stored priors. If
 * they aren't STABLE (same input → same key across runs, across machines,
 * across process restarts), the Bayesian layer silently fragments its own
 * learning. These tests lock down that stability.
 */

import { describe, expect, it } from 'vitest';
import { computeSymptomKey, describeSymptomKey } from '../src/utils/symptom-key';
import { TriageResponses } from '../src/types';

// A minimal but valid-shaped TriageResponses fixture. Only the five
// KEY_FIELDS matter for the key itself; the other fields are here so the
// type-check passes for the input.
function makeResponses(overrides: Partial<TriageResponses> = {}): TriageResponses {
  return {
    Q1_intent:           'WONT_START',
    Q2_engine_start:     'CRANKS_NO_START',
    Q2b_running_issue:   'NOT_ASKED',
    Q3_sound:            'RAPID_CLICKING',
    Q3b_electrical:      'NOT_ASKED',
    Q4_noise_detail:     'NOT_ASKED',
    Q7_overheat_detail:  'NOT_ASKED',
    Q8_smoke_color:      'NOT_ASKED',
    Q_brake_detail:      'NOT_ASKED',
    Q_gear_detail:       'NOT_ASKED',
    Q6_smells:           'NO_SMELL',
    Q5_lights:           [],
    Q9_recent:           [],
    location_type:       'URBAN',
    recent_rain:         'NONE',
    parked_overnight:    'OUTDOOR',
    vehicle_age_bucket:  '3_7',
    last_fueled:         'WITHIN_WEEK',
    ...overrides,
  } as TriageResponses;
}

describe('computeSymptomKey', () => {
  it('is deterministic — same input → same key', () => {
    const r  = makeResponses();
    const k1 = computeSymptomKey(r);
    const k2 = computeSymptomKey(r);
    expect(k1).toBe(k2);
  });

  it('starts with the "sk_" prefix (visual namespace)', () => {
    expect(computeSymptomKey(makeResponses())).toMatch(/^sk_[0-9a-f]{16}$/);
  });

  it('collides on non-KEY_FIELD differences (that is the whole point)', () => {
    // Two incidents with different Sri Lankan-context answers but identical
    // KEY_FIELDS must share a key so their priors accumulate together.
    const a = computeSymptomKey(makeResponses({ location_type: 'URBAN' }));
    const b = computeSymptomKey(makeResponses({ location_type: 'HILL'  }));
    expect(a).toBe(b);
  });

  it('differs when a KEY_FIELD differs', () => {
    const a = computeSymptomKey(makeResponses({ Q3_sound: 'RAPID_CLICKING' }));
    const b = computeSymptomKey(makeResponses({ Q3_sound: 'SINGLE_CLICK'   }));
    expect(a).not.toBe(b);
  });

  it('treats NOT_ASKED as distinct from an actual answer on the same field', () => {
    // A driver who never reached Q3_sound (took NO_CRANK branch) must NOT
    // share a prior with a driver who answered NORMAL_CRANKING.
    const a = computeSymptomKey(makeResponses({ Q3_sound: 'NOT_ASKED' as any }));
    const b = computeSymptomKey(makeResponses({ Q3_sound: 'NORMAL_CRANKING'  }));
    expect(a).not.toBe(b);
  });
});

describe('describeSymptomKey', () => {
  it('returns the five KEY_FIELDS the key was built from', () => {
    const d = describeSymptomKey(makeResponses());
    expect(Object.keys(d).sort()).toEqual(
      ['Q1_intent', 'Q2_engine_start', 'Q3_sound', 'Q7_overheat_detail', 'Q_brake_detail'].sort()
    );
  });
});
