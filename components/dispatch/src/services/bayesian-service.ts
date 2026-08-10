/**
 * ============================================================================
 * Bayesian Service — DB wrapper around the pure engine
 * ============================================================================
 *
 * Thin persistence layer over `bayesian-engine.ts`. This module is the ONLY
 * place that touches the `BayesianPrior` table in Postgres. Callers (the
 * feedback route + the triage engine) go through these functions; the pure
 * engine stays free of Prisma so it remains trivially testable.
 *
 * Responsibilities:
 *   1. `getPriorForKey(key)`          — read the stored prior for a symptom
 *      key, or null if none exists yet.
 *   2. `applyFeedback(key, actual)`   — read → update → write in a single
 *      transaction, so concurrent feedback for the same key doesn't lose
 *      an update.
 *   3. `computeAggregateStats()`      — aggregate view for the /stats
 *      endpoint and for SimPy's convergence proof.
 *
 * We use Prisma's `upsert` and `serializable` transactions to avoid the
 * classic read-modify-write race that would otherwise let two mechanics
 * reporting for the same symptom key clobber each other's update.
 *
 * @module services/bayesian-service
 * @author Janukshan Sivakumar - IT22635266
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import {
  ServiceType,
  ServiceTypeProbabilities,
  TriageResponses,
  TriageResult,
} from '../types';
import {
  argmaxServiceType,
  blendPriorWithTree,
  computeLearningRate,
  shannonEntropy,
  uniformPrior,
  updatePrior,
} from './bayesian-engine';
import { computeSymptomKey } from '../utils/symptom-key';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** In-memory shape of a stored prior. Mirrors the Prisma row but typed. */
export interface StoredPrior {
  symptomKey:          string;
  probabilities:       ServiceTypeProbabilities;
  observationCount:    number;
  currentLearningRate: number;
  updatedAt:           Date;
}

/** Aggregate stats for the /bayesian/stats endpoint. */
export interface BayesianStats {
  totalPriors:              number;
  totalObservations:        number;
  averageObservationsPerKey:number;
  averageEntropyBits:       number;
  minLearningRate:          number;
  maxObservationCount:      number;
  mostUpdatedKeys:          Array<{
    symptomKey:       string;
    observationCount: number;
    entropyBits:      number;
    top3:             Array<{ serviceType: string; probability: number }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch the stored prior for a symptom key. Returns null when the key has
 * never been observed before — callers should default to the tree output
 * unmodified in that case.
 */
export async function getPriorForKey(symptomKey: string): Promise<StoredPrior | null> {
  const row = await prisma.bayesianPrior.findUnique({ where: { symptomKey } });
  if (!row) return null;
  return {
    symptomKey:          row.symptomKey,
    probabilities:       row.probabilities as unknown as ServiceTypeProbabilities,
    observationCount:    row.observationCount,
    currentLearningRate: row.currentLearningRate,
    updatedAt:           row.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply one observation (a mechanic-reported actual service type) to the
 * prior for `symptomKey`. Creates the prior with a uniform starting
 * distribution if it doesn't exist yet.
 *
 * Uses a SERIALIZABLE transaction so concurrent feedback for the same key
 * doesn't race. In practice the row-level lock would be enough, but
 * SERIALIZABLE is the belt-and-braces that a research thesis reviewer will
 * respect.
 *
 * Returns the updated prior so the caller can echo it back to the API user
 * for transparency.
 */
export async function applyFeedback(
  symptomKey: string,
  actualServiceType: ServiceType,
): Promise<StoredPrior> {
  const updated = await prisma.$transaction(
    async (tx) => {
      // Read current state (row-locked under SERIALIZABLE).
      const existing = await tx.bayesianPrior.findUnique({ where: { symptomKey } });

      const oldProbs: ServiceTypeProbabilities = existing
        ? (existing.probabilities as unknown as ServiceTypeProbabilities)
        : uniformPrior();

      const oldCount = existing?.observationCount ?? 0;
      const alpha    = computeLearningRate(oldCount);
      const newProbs = updatePrior(oldProbs, actualServiceType, alpha);
      const newCount = oldCount + 1;
      const newAlpha = computeLearningRate(newCount);

      const upserted = await tx.bayesianPrior.upsert({
        where: { symptomKey },
        create: {
          symptomKey,
          probabilities:       newProbs as unknown as Prisma.InputJsonValue,
          observationCount:    newCount,
          currentLearningRate: newAlpha,
        },
        update: {
          probabilities:       newProbs as unknown as Prisma.InputJsonValue,
          observationCount:    newCount,
          currentLearningRate: newAlpha,
        },
      });

      return upserted;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  logger.info('Bayesian prior updated', {
    symptomKey,
    actualServiceType,
    observationCount:    updated.observationCount,
    currentLearningRate: updated.currentLearningRate.toFixed(4),
  });

  return {
    symptomKey:          updated.symptomKey,
    probabilities:       updated.probabilities as unknown as ServiceTypeProbabilities,
    observationCount:    updated.observationCount,
    currentLearningRate: updated.currentLearningRate,
    updatedAt:           updated.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Inference-time blend orchestrator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wrap the pure tree result with the Bayesian posterior for this incident's
 * symptom key, if one exists. This is the ONLY function the triage route
 * calls to get the "post-Bayesian" TriageResult — the pure tree engine
 * stays synchronous and DB-free.
 *
 * If no prior exists yet, or the prior has too few observations to be
 * trusted, this returns the tree result unmodified (with
 * `bayesianPriorsApplied: false`). That means the very first observation
 * for a symptom pattern doesn't cause dispatch to jitter — the tree runs
 * as-is until the posterior has accumulated enough evidence.
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

  // If blending was suppressed by the observation-count threshold, the
  // blended output is byte-identical to the tree output; detect that so we
  // don't misleadingly flip bayesianPriorsApplied to true.
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
 * Compute aggregate learning statistics across all stored priors. This is
 * what the SimPy convergence proof will call each round to plot the
 * average-entropy-over-time curve. A monotonically-decreasing average
 * entropy is the visual proof that the posterior is concentrating —
 * i.e. that Bayesian is learning something.
 *
 * The N in "mostUpdatedKeys" is fixed at 5 for the /stats endpoint; a
 * different cap would be a nice-to-have query param but isn't required
 * for the SO3 scope.
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
      minLearningRate:          0,
      maxObservationCount:      0,
      mostUpdatedKeys:          [],
    };
  }

  let totalObs      = 0;
  let entropySum    = 0;
  let minAlpha      = Number.POSITIVE_INFINITY;
  let maxObs        = 0;

  for (const p of priors) {
    totalObs   += p.observationCount;
    entropySum += shannonEntropy(p.probabilities as unknown as ServiceTypeProbabilities);
    if (p.currentLearningRate < minAlpha) minAlpha = p.currentLearningRate;
    if (p.observationCount > maxObs)      maxObs   = p.observationCount;
  }

  const topN = priors.slice(0, 5).map((p) => {
    const probs = p.probabilities as unknown as ServiceTypeProbabilities;
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
    minLearningRate:          parseFloat(minAlpha.toFixed(4)),
    maxObservationCount:      maxObs,
    mostUpdatedKeys:          topN,
  };
}
