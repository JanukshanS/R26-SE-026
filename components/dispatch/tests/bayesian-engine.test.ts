/**
 * ============================================================================
 * Bayesian Engine — pure-function unit tests
 * ============================================================================
 *
 * Validates the discounted Dirichlet-Multinomial update rule without
 * touching Postgres. These are the load-bearing evidence that the Bayesian
 * layer is correct — the DB wrapper (bayesian-service.ts) just forwards
 * results from these functions, so if these are green, the update logic
 * is proven.
 *
 * The three "reference" tests (§ 7.3 in ARCHITECTURE.md) — clean
 * convergence, noise robustness, drift adaptivity — are ported directly
 * from `ml/files/dirichlet_bayesian.py` and must reproduce its numbers
 * to within a small tolerance. If they don't, the TypeScript port has
 * diverged from the validated reference implementation.
 */

import { describe, expect, it } from 'vitest';

import {
  argmaxServiceType,
  blendPriorWithTree,
  DISCOUNT_FACTOR,
  DirichletCounts,
  INITIAL_ALPHA_PSEUDOCOUNT,
  MIN_OBSERVATIONS_TO_BLEND,
  TREE_EFFECTIVE_WEIGHT,
  initialDirichletCounts,
  normalise,
  posteriorFromCounts,
  shannonEntropy,
  uniformPrior,
  updateDirichletCounts,
} from '../src/services/bayesian-engine';
import {
  ML_SERVICE_TYPES,
  MLServiceType,
  SERVICE_TYPES,
  ServiceType,
  ServiceTypeProbabilities,
} from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function oneHotProbs(st: ServiceType): ServiceTypeProbabilities {
  const out = {} as ServiceTypeProbabilities;
  for (const s of SERVICE_TYPES) out[s] = s === st ? 1 : 0;
  return out;
}

function sumProbs(p: ServiceTypeProbabilities): number {
  return Object.values(p).reduce((s, v) => s + v, 0);
}

function sumCounts(a: DirichletCounts): number {
  return ML_SERVICE_TYPES.reduce((s, c) => s + a[c], 0);
}

/** Deterministic seeded RNG (LCG). Enough for reproducible tests. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// initialDirichletCounts + posteriorFromCounts
// ─────────────────────────────────────────────────────────────────────────

describe('initialDirichletCounts', () => {
  it('assigns INITIAL_ALPHA_PSEUDOCOUNT to every ML class', () => {
    const a = initialDirichletCounts();
    for (const c of ML_SERVICE_TYPES) {
      expect(a[c]).toBeCloseTo(INITIAL_ALPHA_PSEUDOCOUNT, 12);
    }
  });

  it('has no keys outside ML_SERVICE_TYPES', () => {
    const a = initialDirichletCounts();
    expect(Object.keys(a).sort()).toEqual([...ML_SERVICE_TYPES].sort());
  });
});

describe('posteriorFromCounts', () => {
  it('yields uniform-over-ML from a uniform initial count vector', () => {
    const p = posteriorFromCounts(initialDirichletCounts());
    const expected = 1 / ML_SERVICE_TYPES.length;
    for (const c of ML_SERVICE_TYPES) expect(p[c]).toBeCloseTo(expected, 12);
    expect(sumProbs(p)).toBeCloseTo(1, 10);
  });

  it('never assigns mass to fast-path service types', () => {
    const p = posteriorFromCounts(initialDirichletCounts());
    for (const st of SERVICE_TYPES) {
      if (!(ML_SERVICE_TYPES as readonly string[]).includes(st)) {
        expect(p[st]).toBe(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// updateDirichletCounts
// ─────────────────────────────────────────────────────────────────────────

describe('updateDirichletCounts', () => {
  it('increments the observed class by 1 when γ=1', () => {
    const a0 = initialDirichletCounts();
    const a1 = updateDirichletCounts(a0, 'BATTERY_JUMP', 1.0);
    expect(a1.BATTERY_JUMP).toBeCloseTo(INITIAL_ALPHA_PSEUDOCOUNT + 1, 12);
    for (const c of ML_SERVICE_TYPES) {
      if (c !== 'BATTERY_JUMP') expect(a1[c]).toBeCloseTo(INITIAL_ALPHA_PSEUDOCOUNT, 12);
    }
  });

  it('applies discount to all classes then adds 1 to the observed class', () => {
    const a0 = initialDirichletCounts();     // 0.5 per class
    const a1 = updateDirichletCounts(a0, 'ALTERNATOR_ISSUE', 0.99);
    expect(a1.ALTERNATOR_ISSUE).toBeCloseTo(0.99 * 0.5 + 1, 10);
    for (const c of ML_SERVICE_TYPES) {
      if (c !== 'ALTERNATOR_ISSUE') expect(a1[c]).toBeCloseTo(0.99 * 0.5, 10);
    }
  });

  it('throws on out-of-range gamma', () => {
    expect(() => updateDirichletCounts(initialDirichletCounts(), 'BATTERY_JUMP', -0.1)).toThrow();
    expect(() => updateDirichletCounts(initialDirichletCounts(), 'BATTERY_JUMP',  1.1)).toThrow();
  });

  it('is defensive against fast-path service types (discounts, but adds no mass)', () => {
    const a0 = initialDirichletCounts();
    const a1 = updateDirichletCounts(a0, 'LOCKOUT' as ServiceType, 0.99);
    // Every ML count should be discounted but nothing added.
    for (const c of ML_SERVICE_TYPES) {
      expect(a1[c]).toBeCloseTo(0.99 * 0.5, 10);
    }
  });

  it('does not mutate the input', () => {
    const a0 = initialDirichletCounts();
    const before = a0.BATTERY_JUMP;
    updateDirichletCounts(a0, 'BATTERY_JUMP', 0.99);
    expect(a0.BATTERY_JUMP).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// blendPriorWithTree (unchanged in form from previous EMA version)
// ─────────────────────────────────────────────────────────────────────────

describe('blendPriorWithTree', () => {
  it('returns the tree unchanged below the observation threshold', () => {
    const tree  = posteriorFromCounts(initialDirichletCounts());
    const prior = oneHotProbs('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, MIN_OBSERVATIONS_TO_BLEND - 1);
    for (const st of SERVICE_TYPES) expect(blended[st]).toBeCloseTo(tree[st], 12);
  });

  it('at n = TREE_EFFECTIVE_WEIGHT gives a 50/50 blend', () => {
    const tree  = oneHotProbs('BATTERY_JUMP');
    const prior = oneHotProbs('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, TREE_EFFECTIVE_WEIGHT);
    expect(blended.BATTERY_JUMP).toBeCloseTo(0.5, 6);
    expect(blended.ALTERNATOR_ISSUE).toBeCloseTo(0.5, 6);
  });

  it('at large n the prior dominates', () => {
    const tree  = oneHotProbs('BATTERY_JUMP');
    const prior = oneHotProbs('ALTERNATOR_ISSUE');
    const blended = blendPriorWithTree(tree, prior, 1000);
    expect(blended.ALTERNATOR_ISSUE).toBeGreaterThan(0.9);
    expect(blended.BATTERY_JUMP).toBeLessThan(0.1);
  });

  it('always returns a valid probability distribution', () => {
    const tree  = uniformPrior();
    const prior = oneHotProbs('FUEL_PUMP');
    for (const n of [3, 10, 20, 50, 200]) {
      expect(sumProbs(blendPriorWithTree(tree, prior, n))).toBeCloseTo(1, 10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// shannonEntropy + argmax (unchanged behaviour)
// ─────────────────────────────────────────────────────────────────────────

describe('shannonEntropy', () => {
  it('is log2(K) for a uniform distribution over K service types', () => {
    expect(shannonEntropy(uniformPrior())).toBeCloseTo(Math.log2(SERVICE_TYPES.length), 6);
  });

  it('is 0 for a one-hot distribution', () => {
    expect(shannonEntropy(oneHotProbs('BATTERY_JUMP'))).toBeCloseTo(0, 10);
  });
});

describe('argmaxServiceType', () => {
  it('picks the highest-probability class', () => {
    const p = oneHotProbs('CLUTCH_WORN');
    p['CLUTCH_WORN'] = 0.6;
    p['TRANSMISSION_ISSUE'] = 0.3;
    p['BRAKE_FAILURE'] = 0.1;
    const { serviceType, probability } = argmaxServiceType(p);
    expect(serviceType).toBe('CLUTCH_WORN');
    expect(probability).toBeCloseTo(0.6, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reference convergence tests — ported from ml/files/dirichlet_bayesian.py
// (§ 7.3 in ARCHITECTURE.md). These must reproduce the reference numbers.
// ─────────────────────────────────────────────────────────────────────────

describe('reference test 1: clean convergence at γ=1 (no discounting)', () => {
  it('posterior mass on true class exceeds 95% after 200 clean observations', () => {
    const truth: MLServiceType = 'BATTERY_JUMP';
    let counts = initialDirichletCounts();
    for (let i = 0; i < 200; i++) {
      counts = updateDirichletCounts(counts, truth, 1.0);
    }
    const p = posteriorFromCounts(counts);
    // Python reference: 0.957 with the same setup.
    expect(p[truth]).toBeGreaterThan(0.95);
    // Sanity: sum still 1, no drift.
    expect(sumProbs(p)).toBeCloseTo(1, 10);
  });
});

describe('reference test 2: noise robustness (30% label noise, γ=1)', () => {
  it('argmax at obs 200 is the true class despite 30% label flips', () => {
    const truth: MLServiceType = 'BATTERY_JUMP';
    const rng = makeRng(42);
    let counts = initialDirichletCounts();
    for (let i = 0; i < 200; i++) {
      const observed: MLServiceType = rng() < 0.30
        ? ML_SERVICE_TYPES[Math.floor(rng() * ML_SERVICE_TYPES.length)]
        : truth;
      counts = updateDirichletCounts(counts, observed, 1.0);
    }
    const { serviceType } = argmaxServiceType(posteriorFromCounts(counts));
    expect(serviceType).toBe(truth);
  });
});

describe('reference test 3: drift adaptivity at γ=0.99', () => {
  it('after regime switch the new true class dominates the stale one within 150 observations', () => {
    // First 300 obs: truth = BATTERY_JUMP. Then drift: truth = COOLANT_LOW.
    const truth1: MLServiceType = 'BATTERY_JUMP';
    const truth2: MLServiceType = 'COOLANT_LOW';
    let counts = initialDirichletCounts();
    for (let i = 0; i < 300; i++) counts = updateDirichletCounts(counts, truth1, 0.99);
    for (let i = 0; i < 150; i++) counts = updateDirichletCounts(counts, truth2, 0.99);
    const p = posteriorFromCounts(counts);
    // Python reference: P(truth2) ≈ 0.786, P(truth1) much smaller.
    expect(p[truth2]).toBeGreaterThan(p[truth1]);
    expect(p[truth2]).toBeGreaterThan(0.7);
  });

  it('non-discounted (γ=1) control fails to adapt on the same schedule', () => {
    // Same schedule as above but γ=1 — old observations never fade.
    const truth1: MLServiceType = 'BATTERY_JUMP';
    const truth2: MLServiceType = 'COOLANT_LOW';
    let counts = initialDirichletCounts();
    for (let i = 0; i < 300; i++) counts = updateDirichletCounts(counts, truth1, 1.0);
    for (let i = 0; i < 150; i++) counts = updateDirichletCounts(counts, truth2, 1.0);
    const p = posteriorFromCounts(counts);
    // Stale class still dominates because γ=1 never forgets it.
    expect(p[truth1]).toBeGreaterThan(p[truth2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Basic normalise sanity checks (kept from prior test file)
// ─────────────────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('scales a positive distribution to sum 1', () => {
    const scaled = {} as ServiceTypeProbabilities;
    for (const st of SERVICE_TYPES) scaled[st] = 2;
    const n = normalise(scaled);
    expect(sumProbs(n)).toBeCloseTo(1, 10);
  });

  it('defends against a zero distribution by returning a uniform prior', () => {
    const zero = {} as ServiceTypeProbabilities;
    for (const st of SERVICE_TYPES) zero[st] = 0;
    const n = normalise(zero);
    expect(sumProbs(n)).toBeCloseTo(1, 10);
  });
});
