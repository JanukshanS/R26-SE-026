/**
 * ============================================================================
 * Bayesian Service — DB wrapper around the Dirichlet-Multinomial engine
 * ============================================================================
 *
 * Thin persistence layer over `bayesian-engine.ts`. This module is the ONLY
 * place that touches the `BayesianPrior` table in Postgres. Callers (the
 * feedback route + the triage engine) go through these functions; the pure
 * engine stays free of Prisma so it remains trivially testable.
 *
 * WHAT'S STORED PER SYMPTOM KEY
 * -----------------------------
 *   alpha              — 19-dim Dirichlet pseudo-count vector (source of truth)
 *   probabilities      — 29-key ServiceType distribution derived from alpha
 *                        (denormalised for read-path convenience)
 *   observationCount   — count of REAL resolution outcomes (n_x) — used as
 *                        the blend weight; independent of the α mass which
 *                        is exponentially discounted every update.
 *
 * We use Prisma's `upsert` inside a SERIALIZABLE transaction to avoid the
 * classic read-modify-write race that would let two mechanics reporting
 * feedback for the same symptom key clobber each other's update.
 *
 * @module services/bayesian-service
 * @author Janukshan Sivakumar - IT22635266
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import {
  ML_SERVICE_TYPES,
  ServiceType,
  ServiceTypeProbabilities,
  TriageResponses,
  TriageResult,
} from '../types';
import {
  DISCOUNT_FACTOR,
  DirichletCounts,
  argmaxServiceType,
  blendPriorWithTree,
  initialDirichletCounts,
  posteriorFromCounts,
  shannonEntropy,
  updateDirichletCounts,
} from './bayesian-engine';
import { computeSymptomKey } from '../utils/symptom-key';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** In-memory shape of a stored prior. Mirrors the Prisma row but typed. */
export interface StoredPrior {
  symptomKey:          string;
  /** 19-dim Dirichlet pseudo-count vector — source of truth. */
  alpha:               DirichletCounts;
  /** 29-key ServiceType probability distribution derived from alpha. */
  probabilities:       ServiceTypeProbabilities;
  /** Number of REAL resolution outcomes recorded for this key (n_x). */
  observationCount:    number;
  /** Fixed discount factor γ (0.99). Retained in the schema for stability. */
  currentLearningRate: number;
  updatedAt:           Date;
}

/** Aggregate stats for the /bayesian/stats endpoint. */
export interface BayesianStats {
  totalPriors:              number;
  totalObservations:        number;
  averageObservationsPerKey:number;
  averageEntropyBits:       number;
  discountFactor:           number;
  maxObservationCount:      number;
  mostUpdatedKeys:          Array<{
    symptomKey:       string;
    observationCount: number;
    entropyBits:      number;
    top3:             Array<{ serviceType: string; probability: number }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Alpha (de)serialisation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read an `alpha` JSON column into a DirichletCounts object. Missing keys
 * default to INITIAL_ALPHA_PSEUDOCOUNT (0.5) via `initialDirichletCounts` —
 * so pre-migration rows (where alpha is null) still work, and forward-compat
 * with class-catalog additions is preserved.
 */
function parseAlphaJson(json: unknown): DirichletCounts {
  const base = initialDirichletCounts();
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    for (const c of ML_SERVICE_TYPES) {
      const v = obj[c];
      if (typeof v === 'number' && Number.isFinite(v)) base[c] = v;
    }
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch the stored prior for a symptom key. Returns null when the key has
 * never been observed before — callers default to the tree output
 * unmodified in that case.
 */
export async function getPriorForKey(symptomKey: string): Promise<StoredPrior | null> {
  const row = await prisma.bayesianPrior.findUnique({ where: { symptomKey } });
  if (!row) return null;
  const alpha = parseAlphaJson(row.alpha);
  return {
    symptomKey:          row.symptomKey,
    alpha,
    probabilities:       posteriorFromCounts(alpha),
    observationCount:    row.observationCount,
    currentLearningRate: row.currentLearningRate,
    updatedAt:           row.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply one observation to the Dirichlet posterior for `symptomKey`.
 * Creates the prior with a Jeffreys-uniform starting vector (all α_k = 0.5)
 * if this symptom pattern has never been observed.
 *
 * Uses a SERIALIZABLE transaction so concurrent feedback for the same
 * key doesn't race. Row-level locking alone would suffice; SERIALIZABLE
 * is the belt-and-braces the paper's methodology section can point at.
 *
 * Returns the updated prior so the caller can echo it back to the API
 * user for transparency.
 */
export async function applyFeedback(
  symptomKey: string,
  actualServiceType: ServiceType,
): Promise<StoredPrior> {
  const updated = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.bayesianPrior.findUnique({ where: { symptomKey } });

      const oldAlpha: DirichletCounts = existing
        ? parseAlphaJson(existing.alpha)
        : initialDirichletCounts();
      const oldCount = existing?.observationCount ?? 0;

      const newAlpha = updateDirichletCounts(oldAlpha, actualServiceType, DISCOUNT_FACTOR);
      const newProbs = posteriorFromCounts(newAlpha);
      const newCount = oldCount + 1;

      const upserted = await tx.bayesianPrior.upsert({
        where: { symptomKey },
        create: {
          symptomKey,
          alpha:               newAlpha as unknown as Prisma.InputJsonValue,
          probabilities:       newProbs as unknown as Prisma.InputJsonValue,
          observationCount:    newCount,
          currentLearningRate: DISCOUNT_FACTOR,
        },
        update: {
          alpha:               newAlpha as unknown as Prisma.InputJsonValue,
          probabilities:       newProbs as unknown as Prisma.InputJsonValue,
          observationCount:    newCount,
          currentLearningRate: DISCOUNT_FACTOR,
        },
      });

      return upserted;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  logger.info('Bayesian prior updated (Dirichlet-multinomial)', {
    symptomKey,
    actualServiceType,
    observationCount: updated.observationCount,
    discountFactor:   DISCOUNT_FACTOR,
  });

  const finalAlpha = parseAlphaJson(updated.alpha);
  return {
    symptomKey:          updated.symptomKey,
    alpha:               finalAlpha,
    probabilities:       posteriorFromCounts(finalAlpha),
    observationCount:    updated.observationCount,
    currentLearningRate: updated.currentLearningRate,
    updatedAt:           updated.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Inference-time blend orchestrator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wrap the pure tree result with the Bayesian posterior for this
 * incident's symptom key, if one exists. This is the ONLY function the
 * triage route calls to get the "post-Bayesian" TriageResult — the pure
 * tree engine stays synchronous and DB-free.
 *
 * If no prior exists, or the prior has fewer than MIN_OBSERVATIONS_TO_BLEND
 * real observations, the tree result is returned unmodified (with
 * `bayesianPriorsApplied: false`).
 */
export async function blendTriageWithPrior(
  responses: TriageResponses,
  treeResult: TriageResult,
): Promise<TriageResult> {
  const symptomKey = computeSymptomKey(responses);
  const stored     = await getPriorForKey(symptomKey);

  if (!stored) return treeResult;

  const blended = blendPriorWithTree(
    treeResult.probabilities,
    stored.probabilities,
    stored.observationCount,
  );

  // If blending was suppressed (n_x < MIN_OBSERVATIONS_TO_BLEND), the
  // blended output equals the tree output — don't misleadingly flip
  // bayesianPriorsApplied to true.
  const unchanged = distributionsEqual(blended, treeResult.probabilities);
  if (unchanged) return treeResult;

  const argmax = argmaxServiceType(blended);

  return {
    ...treeResult,
    probabilities:         blended,
    predictedServiceType:  argmax.serviceType,
    confidence:            argmax.probability,
    entropy:               shannonEntropy(blended),
    bayesianPriorsApplied: true,
    tier:                  'BAYESIAN_LEARNED',
  };
}

/** Element-wise near-equality test on a 29-element distribution. */
function distributionsEqual(
  a: ServiceTypeProbabilities,
  b: ServiceTypeProbabilities,
): boolean {
  const EPS = 1e-12;
  for (const k of Object.keys(a) as (keyof ServiceTypeProbabilities)[]) {
    if (Math.abs((a[k] as number) - (b[k] as number)) > EPS) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregate stats
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute aggregate learning statistics across all stored priors. Feeds the
 * /bayesian/stats endpoint and the SimPy convergence-trajectory measurement.
 * A monotonically-decreasing average entropy over time is the visual proof
 * that posteriors are concentrating on their true classes.
 */
export async function computeAggregateStats(): Promise<BayesianStats> {
  const priors = await prisma.bayesianPrior.findMany({
    orderBy: { observationCount: 'desc' },
  });

  if (priors.length === 0) {
    return {
      totalPriors:              0,
      totalObservations:        0,
      averageObservationsPerKey:0,
      averageEntropyBits:       0,
      discountFactor:           DISCOUNT_FACTOR,
      maxObservationCount:      0,
      mostUpdatedKeys:          [],
    };
  }

  let totalObs   = 0;
  let entropySum = 0;
  let maxObs     = 0;

  for (const p of priors) {
    totalObs += p.observationCount;
    const alpha = parseAlphaJson(p.alpha);
    entropySum += shannonEntropy(posteriorFromCounts(alpha));
    if (p.observationCount > maxObs) maxObs = p.observationCount;
  }

  const topN = priors.slice(0, 5).map((p) => {
    const alpha = parseAlphaJson(p.alpha);
    const probs = posteriorFromCounts(alpha);
    const top3  = Object.entries(probs)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([serviceType, probability]) => ({
        serviceType,
        probability: parseFloat((probability as number).toFixed(4)),
      }));
    return {
      symptomKey:       p.symptomKey,
      observationCount: p.observationCount,
      entropyBits:      parseFloat(shannonEntropy(probs).toFixed(4)),
      top3,
    };
  });

  return {
    totalPriors:              priors.length,
    totalObservations:        totalObs,
    averageObservationsPerKey:parseFloat((totalObs / priors.length).toFixed(2)),
    averageEntropyBits:       parseFloat((entropySum / priors.length).toFixed(4)),
    discountFactor:           DISCOUNT_FACTOR,
    maxObservationCount:      maxObs,
    mostUpdatedKeys:          topN,
  };
}
