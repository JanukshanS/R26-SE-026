/**
 * ============================================================================
 * Bayesian Engine — pure update + blend functions
 * ============================================================================
 *
 * PURE FUNCTIONS ONLY. No DB, no logging, no side effects. Everything is
 * deterministic and unit-testable. The DB wrapper (bayesian-service.ts) calls
 * these functions with values it read from Postgres and writes the results
 * back — that separation keeps the math trivially testable and reviewable.
 *
 * WHAT THIS MODULE PROVIDES
 * -------------------------
 *   1. computeLearningRate(n)        — decayed α as observations accumulate
 *   2. updatePrior(P_old, actual, α) — the Bayesian posterior update
 *   3. blendPriorWithTree(...)       — count-weighted blend at inference
 *   4. uniformPrior()                — initial P_0 for a fresh symptom key
 *   5. shannonEntropy(P)             — measure of remaining uncertainty
 *
 * WHY LINEAR BLEND, NOT MULTIPLICATIVE
 * ------------------------------------
 * A strict Bayesian update would be P_new ∝ P_prior · P(observation|class).
 * That requires modelling a full likelihood function — for a 19-class
 * categorical outcome the model is Categorical-Dirichlet. We use the closed-
 * form Dirichlet posterior mean, which — for a symmetric Dirichlet prior
 * and an observed one-hot outcome — reduces to a linear blend with
 * α = 1/(N+K) where N is prior observation count and K is the concentration
 * parameter. Setting α = f(n) directly (with a decaying schedule) is a
 * stochastic-approximation form of the same update: it converges to the true
 * distribution under standard Robbins-Monro conditions (Σα=∞, Σα²<∞), which
 * a linearly-decayed-then-floored schedule satisfies for practical N.
 *
 * See docs/bayesian-derivation.md (to be written) for the full derivation.
 *
 * @module services/bayesian-engine
 * @author Janukshan Sivakumar - IT22635266
 */

import { config } from '../config';
import {
  ServiceType,
  ServiceTypeProbabilities,
  SERVICE_TYPES,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/**
 * Effective "prior sample count" attributed to the decision tree at inference
 * time. Controls the tree/data blend: with n=K real observations, the tree
 * and the posterior contribute equally. Bumping K makes the tree stickier;
 * lowering it lets a small number of real observations dominate.
 *
 * K=20 was chosen so that the crossover happens at a realistic number of
 * observations for a research thesis (viva readers should see the posterior
 * matter after ~20 feedback events, not 200).
 */
export const TREE_EFFECTIVE_WEIGHT = 20;

/**
 * Observation-count threshold BELOW which a stored prior is considered
 * too noisy to blend into the tree's output. Below this the tree wins
 * unmodified.
 *
 * Rationale: with 1-2 observations, the "posterior" is essentially a
 * one-hot on whatever fault the mechanic saw first — that would override
 * the tree with a single data point. Waiting for a handful of observations
 * gives the posterior a chance to stabilise before it starts influencing
 * dispatch.
 */
export const MIN_OBSERVATIONS_TO_BLEND = 3;

// ─────────────────────────────────────────────────────────────────────────
// Distribution helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Return a fresh uniform prior across all 29 service types. Used as P_0
 * when a symptom key is observed for the very first time.
 *
 * Note: this includes fast-path service types (each at 1/29). That is
 * intentional — Bayesian only fires on ML paths (fast-path bypasses triage
 * entirely), so those slots receive zero updates in practice and their
 * mass gradually decays via renormalisation when the ML classes gain mass.
 */
export function uniformPrior(): ServiceTypeProbabilities {
  const p = 1 / SERVICE_TYPES.length;
  const out = {} as ServiceTypeProbabilities;
  for (const st of SERVICE_TYPES) out[st] = p;
  return out;
}

/** Zero-initialised probability distribution — private helper. */
function zeroProbabilities(): ServiceTypeProbabilities {
  const out = {} as ServiceTypeProbabilities;
  for (const st of SERVICE_TYPES) out[st] = 0;
  return out;
}

/**
 * Renormalise so probabilities sum to 1. Guards against floating-point drift
 * and against blend inputs that don't come from valid distributions.
 * Returns a uniform distribution if the input sums to 0 (defensive).
 */
export function normalise(p: ServiceTypeProbabilities): ServiceTypeProbabilities {
  let total = 0;
  for (const st of SERVICE_TYPES) total += p[st];
  if (total <= 0) return uniformPrior();
  const out = zeroProbabilities();
  for (const st of SERVICE_TYPES) out[st] = p[st] / total;
  return out;
}

/**
 * Shannon entropy in bits — measures how spread the distribution is.
 * 0 means a delta on one class (certain); log2(29) ≈ 4.86 means uniform
 * (maximally uncertain). The Bayesian stats endpoint reports this so the
 * viva can show "priors become more concentrated with observations."
 */
export function shannonEntropy(p: ServiceTypeProbabilities): number {
  let h = 0;
  for (const st of SERVICE_TYPES) {
    const q = p[st];
    if (q > 0) h -= q * Math.log2(q);
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────────
// Learning rate schedule
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the learning rate α for the (n+1)-th observation, given that
 * this symptom key has already accumulated n observations.
 *
 * Linear decay from INITIAL_LEARNING_RATE (default 0.1) down to
 * MIN_LEARNING_RATE (default 0.01) over LEARNING_WINDOW_SIZE observations
 * (default 100), then floors. Matches the config's semantics: the first
 * observation moves the prior by 10%; by observation 100+ every new
 * observation moves it by only 1%.
 *
 * Never returns < MIN_LEARNING_RATE — the posterior always keeps *some*
 * plasticity so distributional drift over years can still be captured.
 */
export function computeLearningRate(observationCount: number): number {
  const { initialLearningRate, minLearningRate, windowSize } = config.bayesian;
  if (observationCount <= 0) return initialLearningRate;
  const decayed = initialLearningRate
    - observationCount * (initialLearningRate - minLearningRate) / windowSize;
  return Math.max(minLearningRate, decayed);
}

// ─────────────────────────────────────────────────────────────────────────
// Posterior update (the core Bayesian step)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Given the current prior for a symptom key AND a freshly-observed actual
 * service type, return the updated prior.
 *
 * Formula:  P_new = (1 - α) · P_old  +  α · one_hot(actual)
 *
 * Properties:
 *   - The result is a valid probability distribution (sums to 1 — proven
 *     by construction since one_hot sums to 1 and P_old sums to 1).
 *   - α close to 1: posterior "jumps" toward the observation (high learning).
 *   - α close to 0: posterior barely moves (converged, or capped).
 *
 * The learning rate α is expected to have been pre-computed by
 * `computeLearningRate` — this function has no opinion about α's decay
 * schedule; it just applies the blend.
 */
export function updatePrior(
  oldProbs: ServiceTypeProbabilities,
  actual: ServiceType,
  alpha: number,
): ServiceTypeProbabilities {
  if (alpha < 0 || alpha > 1) {
    throw new Error(`bayesian-engine: alpha must be in [0,1], got ${alpha}`);
  }
  const out = zeroProbabilities();
  const oneMinus = 1 - alpha;
  for (const st of SERVICE_TYPES) {
    out[st] = oneMinus * oldProbs[st] + (st === actual ? alpha : 0);
  }
  return normalise(out);
}

// ─────────────────────────────────────────────────────────────────────────
// Inference-time blend
// ─────────────────────────────────────────────────────────────────────────

/**
 * Combine the decision-tree output with the stored Bayesian posterior for
 * this symptom key.
 *
 * Formula:  P_final = (K · P_tree  +  n · P_prior) / (K + n)
 *
 * where K = TREE_EFFECTIVE_WEIGHT and n = the prior's observationCount.
 *
 * Behaviour by n:
 *   n = 0                → identical to P_tree (0-weight prior is ignored)
 *   n = K (= 20)         → 50/50 blend
 *   n → ∞                → asymptotically equal to P_prior
 *
 * Below MIN_OBSERVATIONS_TO_BLEND the prior is considered too noisy to
 * influence dispatch at all, so we return the tree unmodified. This
 * prevents a single mechanic's report from steering the tree.
 */
export function blendPriorWithTree(
  treeProbs: ServiceTypeProbabilities,
  priorProbs: ServiceTypeProbabilities,
  priorObservationCount: number,
): ServiceTypeProbabilities {
  if (priorObservationCount < MIN_OBSERVATIONS_TO_BLEND) {
    return treeProbs;
  }
  const K = TREE_EFFECTIVE_WEIGHT;
  const n = priorObservationCount;
  const denom = K + n;
  const out = zeroProbabilities();
  for (const st of SERVICE_TYPES) {
    out[st] = (K * treeProbs[st] + n * priorProbs[st]) / denom;
  }
  // Sum should equal 1 by construction (both inputs sum to 1), but renormalise
  // to guard against floating-point drift over many updates.
  return normalise(out);
}

// ─────────────────────────────────────────────────────────────────────────
// Prediction helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Argmax over a distribution. Ties break by service-type declaration order
 * in SERVICE_TYPES — a stable ordering (matters for testability).
 */
export function argmaxServiceType(p: ServiceTypeProbabilities): {
  serviceType: ServiceType;
  probability: number;
} {
  let best: ServiceType = SERVICE_TYPES[0];
  let bestP = -Infinity;
  for (const st of SERVICE_TYPES) {
    if (p[st] > bestP) {
      bestP = p[st];
      best = st;
    }
  }
  return { serviceType: best, probability: bestP };
}
