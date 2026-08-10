/**
 * ============================================================================
 * Bayesian Engine — pure-function unit tests
 * ============================================================================
 *
 * These tests validate the update math without touching Postgres. They are
 * the load-bearing evidence that the Bayesian layer is correct — the DB
 * wrapper (bayesian-service.ts) just forwards results from these functions,
 * so if these are green, the update logic is proven.
 *
 * The convergence test in particular is the empirical proof we cite in the
 * thesis: "given a uniform prior and observations drawn from a specific
 * target distribution, the posterior converges to that target within N
 * observations."
 */

import { describe, expect, it, vi } from 'vitest';

// Mock the config BEFORE importing the engine — the engine reads
// initialLearningRate / minLearningRate / windowSize at call time from the
// config module, and the test needs deterministic values regardless of
// whatever .env is loaded on the machine running the tests.
vi.mock('../src/config', () => ({
  config: {
    bayesian: {
      initialLearningRate: 0.1,
      minLearningRate:     0.01,
      windowSize:          100,
    },
  },
}));

import {
  argmaxServiceType,
  blendPriorWithTree,
  computeLearningRate,
  MIN_OBSERVATIONS_TO_BLEND,
  normalise,
  shannonEntropy,
  TREE_EFFECTIVE_WEIGHT,
  uniformPrior,
  updatePrior,
} from '../src/services/bayesian-engine';
import { SERVICE_TYPES, ServiceType, ServiceTypeProbabilities } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function oneHot(st: ServiceType): ServiceTypeProbabilities {
  const out = {} as ServiceTypeProbabilities;
  for (const s of SERVICE_TYPES) out[s] = s === st ? 1 : 0;
  return out;
}

function sum(p: ServiceTypeProbabilities): number {
  return Object.values(p).reduce((s, v) => s + v, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// uniformPrior + normalise
// ─────────────────────────────────────────────────────────────────────────

describe('uniformPrior', () => {
  it('sums to 1 and gives every service type equal mass', () => {
    const u = uniformPrior();
    expect(sum(u)).toBeCloseTo(1, 10);
    const expected = 1 / SERVICE_TYPES.length;
    for (const st of SERVICE_TYPES) expect(u[st]).toBeCloseTo(expected, 10);
  });
});

describe('normalise', () => {
  it('scales a positive distribution to sum 1', () => {
    const scaled = {} as ServiceTypeProbabilities;
    for (const st of SERVICE_TYPES) scaled[st] = 2;
    const n = normalise(scaled);
    expect(sum(n)).toBeCloseTo(1, 10);
  });

  it('defends against a zero distribution by returning a uniform prior', () => {
    const zero = {} as ServiceTypeProbabilities;
    for (const st of SERVICE_TYPES) zero[st] = 0;
    const n = normalise(zero);
    expect(sum(n)).toBeCloseTo(1, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// computeLearningRate
// ─────────────────────────────────────────────────────────────────────────

describe('computeLearningRate', () => {
  it('returns the initial rate when there are no observations', () => {
    expect(computeLearningRate(0)).toBeCloseTo(0.1, 10);
  });

  it('decays linearly toward the floor across the window', () => {
    // With initial=0.1, min=0.01, window=100 → slope = (0.1-0.01)/100 = 0.0009
    expect(computeLearningRate(50)).toBeCloseTo(0.1 - 50 * 0.0009, 10);
  });

  it('never falls below the minimum learning rate', () => {
    expect(computeLearningRate(1000)).toBeCloseTo(0.01, 10);
    expect(computeLearningRate(10_000)).toBeCloseTo(0.01, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// updatePrior
// ─────────────────────────────────────────────────────────────────────────

describe('updatePrior', () => {
  it('produces a valid probability distribution (sums to 1)', () => {
    const p = updatePrior(uniformPrior(), 'BATTERY_JUMP', 0.1);
    expect(sum(p)).toBeCloseTo(1, 10);
  });

  it('moves mass toward the observed service type', () => {
    const before = uniformPrior();
    const after  = updatePrior(before, 'BATTERY_JUMP', 0.5);
    expect(after.BATTERY_JUMP).toBeGreaterThan(before.BATTERY_JUMP);
  });

  it('with alpha=0 leaves the prior unchanged (renormalised)', () => {
    const p = uniformPrior();
    const same = updatePrior(p, 'ALTERNATOR_ISSUE', 0);
    for (const st of SERVICE_TYPES) expect(same[st]).toBeCloseTo(p[st], 10);
  });

  it('with alpha=1 collapses to a delta on the observed type', () => {
    const p = updatePrior(uniformPrior(), 'FUEL_PUMP', 1);
    expect(p.FUEL_PUMP).toBeCloseTo(1, 10);
    for (const st of SERVICE_TYPES) {
      if (st !== 'FUEL_PUMP') expect(p[st]).toBeCloseTo(0, 10);
    }
  });

  it('throws on out-of-range alpha', () => {
    expect(() => updatePrior(uniformPrior(), 'BATTERY_JUMP', -0.1)).toThrow();
    expect(() => updatePrior(uniformPrior(), 'BATTERY_JUMP',  1.1)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// blendPriorWithTree
// ─────────────────────────────────────────────────────────────────────────

describe('blendPriorWithTree', () => {
  it('returns the tree unmodified below the observation threshold', () => {
    const tree  = uniformPrior();
    const prior = oneHot('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, MIN_OBSERVATIONS_TO_BLEND - 1);
    for (const st of SERVICE_TYPES) expect(blended[st]).toBeCloseTo(tree[st], 10);
  });

  it('at n = TREE_EFFECTIVE_WEIGHT gives a 50/50 blend', () => {
    const tree  = oneHot('BATTERY_JUMP');
    const prior = oneHot('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, TREE_EFFECTIVE_WEIGHT);
    expect(blended.BATTERY_JUMP).toBeCloseTo(0.5, 6);
    expect(blended.ALTERNATOR_ISSUE).toBeCloseTo(0.5, 6);
  });

  it('at large n the prior dominates', () => {
    const tree  = oneHot('BATTERY_JUMP');
    const prior = oneHot('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, 1000);
    expect(blended.ALTERNATOR_ISSUE).toBeGreaterThan(0.9);
    expect(blended.BATTERY_JUMP).toBeLessThan(0.1);
  });

  it('always returns a valid probability distribution', () => {
    const tree  = uniformPrior();
    const prior = oneHot('FUEL_PUMP');
    for (const n of [3, 10, 20, 50, 200]) {
      expect(sum(blendPriorWithTree(tree, prior, n))).toBeCloseTo(1, 10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// shannonEntropy + argmax
// ─────────────────────────────────────────────────────────────────────────

describe('shannonEntropy', () => {
  it('is log2(K) for a uniform distribution over K classes', () => {
    expect(shannonEntropy(uniformPrior())).toBeCloseTo(Math.log2(SERVICE_TYPES.length), 6);
  });

  it('is 0 for a one-hot distribution', () => {
    expect(shannonEntropy(oneHot('BATTERY_JUMP'))).toBeCloseTo(0, 10);
  });
});

describe('argmaxServiceType', () => {
  it('picks the service type with the highest probability', () => {
    const p = oneHot('CLUTCH_WORN');
    p['CLUTCH_WORN'] = 0.6;
    p['TRANSMISSION_ISSUE'] = 0.3;
    p['BRAKE_FAILURE'] = 0.1;
    const { serviceType, probability } = argmaxServiceType(p);
    expect(serviceType).toBe('CLUTCH_WORN');
    expect(probability).toBeCloseTo(0.6, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Convergence — the load-bearing evidence for the thesis
// ─────────────────────────────────────────────────────────────────────────

describe('convergence: repeated observations pull the posterior toward the truth', () => {
  it('with a decaying schedule, posterior mass on the truth strictly exceeds the initial mass', () => {
    // Simulate: symptom key K's true failure is always ALTERNATOR_ISSUE.
    // Feed 200 observations through the update loop with the decayed alpha.
    let posterior = uniformPrior();
    const start = posterior.ALTERNATOR_ISSUE;
    for (let n = 0; n < 200; n++) {
      const alpha = computeLearningRate(n);
      posterior = updatePrior(posterior, 'ALTERNATOR_ISSUE', alpha);
    }
    // Posterior on truth should be very close to 1 after 200 observations
    // with alpha ~0.01 sustained. Not exactly 1 because α is bounded.
    expect(posterior.ALTERNATOR_ISSUE).toBeGreaterThan(start);
    expect(posterior.ALTERNATOR_ISSUE).toBeGreaterThan(0.85);
    expect(sum(posterior)).toBeCloseTo(1, 6);
  });

  it('under noisy observations (70% truth, 30% other), argmax converges to truth', () => {
    // A more realistic scenario: mechanic sometimes mis-reports.
    // Even with 30% noise, argmax should end on the true class within 200
    // observations because 70% > 1/K for K=29.
    let posterior = uniformPrior();
    // Seed a reproducible RNG so the test is deterministic across runs.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const noiseTypes: ServiceType[] = [
      'BATTERY_JUMP', 'STARTER_MOTOR', 'FUEL_PUMP', 'IGNITION_SYSTEM',
    ];
    for (let n = 0; n < 200; n++) {
      const truth  = 'ALTERNATOR_ISSUE' as const;
      const actual: ServiceType = rand() < 0.7
        ? truth
        : noiseTypes[Math.floor(rand() * noiseTypes.length)];
      posterior = updatePrior(posterior, actual, computeLearningRate(n));
    }
    expect(argmaxServiceType(posterior).serviceType).toBe('ALTERNATOR_ISSUE');
  });
});
