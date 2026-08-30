/**
 * Trouble codes as triage evidence.
 *
 * The claim this layer makes is narrow and worth pinning down: a stored code
 * SHARPENS the decision tree's distribution without ever replacing it. These
 * tests exist mostly to stop that guarantee eroding — it is the difference
 * between "the ECU's opinion is weighed" and "the ECU decides", and only the
 * first is defensible given how partial mode 03 coverage actually is.
 */
import { describe, expect, it } from 'vitest';

import { dtcEvidence, lookupDtc, MAX_DTC_WEIGHT } from '../src/constants/dtc-mapping';
import { runTriageEngine } from '../src/services/triage-engine';
import { SERVICE_TYPES, ServiceType, TriageResponses, OBDData } from '../src/types';

// A questionnaire that reaches the ML path (not a fast-path intent) and says
// as little as possible, so the codes are what moves the answer.
const RESPONSES = {
  Q1_intent:          'WONT_START',
  Q2_engine_start:    'NO_CRANK',
  Q2b_running_issue:  'NOT_ASKED',
  Q3_sound:           'NOT_ASKED',
  Q3b_electrical:     'NOT_ASKED',
  Q4_noise_detail:    'NOT_ASKED',
  Q7_overheat_detail: 'NOT_ASKED',
  Q8_smoke_color:     'NOT_ASKED',
  Q_brake_detail:     'NOT_ASKED',
  Q_gear_detail:      'NOT_ASKED',
  Q6_smells:          'NO_SMELL',
  Q5_lights:          ['NONE'],
  Q9_recent:          ['NO_SIGNS'],
  location_type:      'URBAN',
  recent_rain:        'NONE',
  parked_overnight:   'OUTDOOR',
  vehicle_age_bucket: '8_15',
  last_fueled:        'WITHIN_WEEK',
} as unknown as TriageResponses;

function obd(faultCodes: OBDData['faultCodes']): OBDData {
  return { available: true, faultCodes } as OBDData;
}

const sum = (p: Record<string, number>) =>
  SERVICE_TYPES.reduce((s, st) => s + (p[st] ?? 0), 0);

describe('lookupDtc', () => {
  it('resolves a catalogued code to its exact entry', () => {
    const info = lookupDtc('P0562');
    expect(info?.services).toContain('ALTERNATOR_ISSUE');
    expect(info?.isGeneric).toBe(false);
  });

  it('is case- and whitespace-insensitive, as adapters are inconsistent', () => {
    expect(lookupDtc('  p0562 ')?.services).toEqual(lookupDtc('P0562')?.services);
  });

  it('falls back to the code family for an uncatalogued but real code', () => {
    // Not in the table, but P07xx is unambiguously transmission.
    const info = lookupDtc('P0777');
    expect(info?.services).toContain('TRANSMISSION_ISSUE');
    expect(info?.isGeneric).toBe(true);
  });

  it('returns null for something that is not a trouble code', () => {
    expect(lookupDtc('')).toBeNull();
    expect(lookupDtc('BANANA')).toBeNull();
    expect(lookupDtc('P01')).toBeNull(); // too short to be a real code
  });
});

describe('dtcEvidence', () => {
  it('gives a pending code less weight than a confirmed one', () => {
    const confirmed = dtcEvidence([{ code: 'P0562', status: 'confirmed' }]);
    const pending   = dtcEvidence([{ code: 'P0562', status: 'pending' }]);
    expect(pending.weight).toBeLessThan(confirmed.weight);
  });

  it('weights by the strongest code, not the sum', () => {
    // Four weak codes must not out-weigh one strong one, or a cluster of
    // minor faults could quietly take over the diagnosis.
    const manyWeak = dtcEvidence([
      { code: 'P0171' }, { code: 'P0172' }, { code: 'P0174' }, { code: 'P0175' },
    ]);
    const oneStrong = dtcEvidence([{ code: 'P0562' }]);
    expect(manyWeak.weight).toBeLessThan(oneStrong.weight);
  });

  it('never exceeds the cap, however many codes are stored', () => {
    const lots = dtcEvidence(
      ['P0562', 'P0300', 'P0217', 'P0700', 'P0230'].map((code) => ({ code })),
    );
    expect(lots.weight).toBeLessThanOrEqual(MAX_DTC_WEIGHT);
  });

  it('contributes nothing for codes it cannot resolve', () => {
    const none = dtcEvidence([{ code: 'BANANA' }, { code: '' }]);
    expect(none.weight).toBe(0);
    expect(none.matched).toHaveLength(0);
  });

  it('lets two codes pointing at one service reinforce each other', () => {
    const single = dtcEvidence([{ code: 'P0562' }]);
    const double = dtcEvidence([{ code: 'P0562' }, { code: 'P0620' }]);
    const share = (e: typeof single) => {
      const total = Object.values(e.scores).reduce((s, v) => s + (v ?? 0), 0);
      return total > 0 ? (e.scores.ALTERNATOR_ISSUE ?? 0) / total : 0;
    };
    expect(share(double)).toBeGreaterThan(share(single));
  });
});

describe('runTriageEngine — trouble codes as evidence', () => {
  it('is a no-op when no codes are present', () => {
    const withNone = runTriageEngine(RESPONSES, obd([]));
    const without  = runTriageEngine(RESPONSES, obd(undefined));
    expect(withNone.probabilities).toEqual(without.probabilities);
    expect(withNone.faultCodesApplied).toBe(false);
  });

  it('is a no-op when every code is unrecognised', () => {
    const baseline = runTriageEngine(RESPONSES, obd(undefined));
    const junk     = runTriageEngine(RESPONSES, obd(['BANANA', 'XYZ']));
    expect(junk.probabilities).toEqual(baseline.probabilities);
    expect(junk.faultCodesApplied).toBe(false);
  });

  it('raises the service type a confirmed code points at', () => {
    const baseline = runTriageEngine(RESPONSES, obd(undefined));
    const withCode = runTriageEngine(RESPONSES, obd([{ code: 'P0562', status: 'confirmed' }]));

    expect(withCode.faultCodesApplied).toBe(true);
    expect(withCode.probabilities.ALTERNATOR_ISSUE)
      .toBeGreaterThan(baseline.probabilities.ALTERNATOR_ISSUE);
  });

  it('can lift a service type the tree had written off', () => {
    // The whole reason this is a mixture and not a multiplicative reweight:
    // multiplying a ~0 probability by any factor leaves it ~0, so a
    // conclusive code could never correct a confident tree.
    const baseline = runTriageEngine(RESPONSES, obd(undefined));
    const withCode = runTriageEngine(RESPONSES, obd([{ code: 'P0700', status: 'confirmed' }]));
    expect(baseline.probabilities.TRANSMISSION_ISSUE).toBeLessThan(0.05);
    expect(withCode.probabilities.TRANSMISSION_ISSUE).toBeGreaterThan(0.1);
  });

  it('leaves the questionnaire a meaningful stake — it sharpens, never overrides', () => {
    const withCode = runTriageEngine(RESPONSES, obd([{ code: 'P0700', status: 'confirmed' }]));
    // Even a strong confirmed code cannot claim the whole distribution.
    expect(withCode.probabilities.TRANSMISSION_ISSUE).toBeLessThan(1 - (1 - MAX_DTC_WEIGHT) / 2);
  });

  it('keeps the distribution normalised', () => {
    const withCode = runTriageEngine(
      RESPONSES,
      obd([{ code: 'P0562' }, { code: 'P0300' }]),
    );
    expect(sum(withCode.probabilities as unknown as Record<string, number>)).toBeCloseTo(1, 6);
  });

  it('reports confidence and entropy for the distribution it actually returns', () => {
    const withCode = runTriageEngine(RESPONSES, obd([{ code: 'P0562', status: 'confirmed' }]));
    const maxProb = Math.max(
      ...SERVICE_TYPES.map((st: ServiceType) => withCode.probabilities[st]),
    );
    // Stale figures copied from the tree would not match the reweighted result.
    expect(withCode.confidence).toBeCloseTo(maxProb, 6);
    expect(withCode.entropy).toBeGreaterThan(0);
  });

  it('accepts bare code strings as well as code+status objects', () => {
    const asString = runTriageEngine(RESPONSES, obd(['P0562']));
    const asObject = runTriageEngine(RESPONSES, obd([{ code: 'P0562' }]));
    expect(asString.probabilities).toEqual(asObject.probabilities);
  });

  it('does not touch the fast path, which never runs inference', () => {
    const fastPath = runTriageEngine(
      { ...RESPONSES, Q1_intent: 'FLAT_TIRE' } as unknown as TriageResponses,
      obd([{ code: 'P0562' }]),
    );
    expect(fastPath.probabilities.FLAT_TIRE_CHANGE).toBe(1);
  });
});
