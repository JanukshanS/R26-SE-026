/**
 * ============================================================================
 * Bayesian Engine — Discounted Dirichlet-Multinomial posterior update
 * ============================================================================
 *
 * PURE FUNCTIONS ONLY. No DB, no logging, no side effects. Everything is
 * deterministic and unit-testable. The DB wrapper (bayesian-service.ts) calls
 * these functions with values read from Postgres and writes results back — a
 * separation that keeps the math trivially testable.
 *
 * MODEL
 * -----
 * For each symptom key, maintain a Dirichlet pseudo-count vector
 *   α_x = (α_x,1, ..., α_x,K), K = |ML_SERVICE_TYPES| = 19
 * initialised uniformly at INITIAL_ALPHA_PSEUDOCOUNT (0.5, a Jeffreys prior).
 *
 * On each resolution outcome `k*`:
 *   α_x,k ← γ · α_x,k + 1[k = k*]        (all k, γ = 0.99)
 *   P_prior(k | x) = α_x,k / Σ_j α_x,j
 *
 * This is standard Dirichlet-multinomial conjugacy with exponential
 * discounting (West & Harrison, "Bayesian Forecasting and Dynamic Models",
 * 2nd ed., 1997) — not an ad-hoc EMA. At γ=1 the posterior is exactly the
 * Dirichlet posterior mean and consistency follows directly from
 * conjugacy. At γ<1 the effective sample size is bounded (ESS ≈ 1/(1-γ) ≈
 * 100 at γ=0.99), giving the posterior finite plasticity so it can track
 * genuine distributional drift over time.
 *
 * NOTE — supersedes the earlier EMA implementation
 * -------------------------------------------------
 * The prior EMA formulation was documented as satisfying Robbins-Monro
 * (Σα=∞, Σα²<∞) convergence conditions. This was checked and found FALSE:
 * a linear-decay-then-floor schedule fails Σα²<∞ because α floors at α_min
 * rather than decaying to zero, so Σα² diverges. The Dirichlet-multinomial
 * formulation here has consistency guaranteed by conjugacy, needing no
 * stochastic-approximation machinery.
 *
 * INFERENCE-TIME BLEND (unchanged in form)
 * ----------------------------------------
 *   P_final = (K_tree · P_tree + n_x · P_prior) / (K_tree + n_x)
 * where K_tree = TREE_EFFECTIVE_WEIGHT (20) and n_x is the number of REAL
 * observations recorded for this symptom key (tracked independently of
 * the discounted α mass). Blend is suppressed when n_x < MIN_OBSERVATIONS_TO_BLEND.
 *
 * @module services/bayesian-engine
 * @author Janukshan Sivakumar - IT22635266
 */

import {
  ML_SERVICE_TYPES,
  MLServiceType,
  ServiceType,
  ServiceTypeProbabilities,
  SERVICE_TYPES,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/**
 * Exponential discount factor γ applied to prior pseudo-counts on every
 * update. γ=1 recovers the exact Dirichlet-Multinomial posterior mean
 * (no forgetting). γ<1 gives finite effective sample size:
 *   ESS(γ) ≈ 1/(1-γ)      // ESS ≈ 100 at γ=0.99
 *
 * γ=0.99 is chosen so a symptom pattern's posterior can meaningfully
 * track distributional drift within ~100 observations while still being
 * robust to short-term noise (see convergence tests § 7.3 in
 * ARCHITECTURE.md and tests/bayesian-engine.test.ts).
 */
export const DISCOUNT_FACTOR = 0.99;

/**
 * Initial Dirichlet pseudo-count assigned to every ML class for a
 * previously-unseen symptom key. 0.5 is Jeffreys' prior — minimally
 * informative but proper (all classes reachable). Small enough that one
 * real observation dominates the initial mass yet non-zero so log-domain
 * arithmetic remains safe.
 */
export const INITIAL_ALPHA_PSEUDOCOUNT = 0.5;

/**
 * Effective "prior sample count" attributed to the decision tree at
 * inference time. With n_x = TREE_EFFECTIVE_WEIGHT real observations for
 * a symptom pattern, the tree and the posterior contribute equally to the
 * blend. Bumping this makes the tree stickier; lowering lets a small
 * number of real observations dominate.
 */
export const TREE_EFFECTIVE_WEIGHT = 20;

/**
 * Below this real-observation count, the stored posterior is considered
 * too noisy to influence dispatch — the tree wins unmodified. Prevents
 * a single mechanic's report from steering triage for that symptom
 * pattern.
 */
export const MIN_OBSERVATIONS_TO_BLEND = 3;

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/**
 * Dirichlet pseudo-count vector over the 19 ML-diagnosable classes.
 * Fast-path service types are NOT included — the Bayesian layer only
 * fires on the ML path (fast-path bypasses triage entirely).
 */
export type DirichletCounts = Record<MLServiceType, number>;

// ─────────────────────────────────────────────────────────────────────────
// Dirichlet count vector helpers
// ─────────────────────────────────────────────────────────────────────────

/** A fresh, uniformly-initialised Dirichlet vector (Jeffreys prior). */
export function initialDirichletCounts(): DirichletCounts {
  const out = {} as DirichletCounts;
  for (const c of ML_SERVICE_TYPES) out[c] = INITIAL_ALPHA_PSEUDOCOUNT;
  return out;
}

/**
 * Apply one observation to a Dirichlet count vector using the discounted
 * update rule. Returns a NEW object; the input is not mutated.
 *
 *   α_k ← γ · α_k + 1[k = actual]
 *
 * If `actual` is a fast-path service type (not in ML_SERVICE_TYPES), the
 * function still discounts existing counts but adds no observation mass
 * — a defensive stance that keeps the vector well-formed even if a
 * caller misuses the API. Callers should not update from fast-path
 * outcomes; the Bayesian layer is not the right tool for those.
 */
export function updateDirichletCounts(
  counts: DirichletCounts,
  actual: ServiceType,
  gamma: number = DISCOUNT_FACTOR,
): DirichletCounts {
  if (gamma < 0 || gamma > 1) {
    throw new Error(`bayesian-engine: gamma must be in [0,1], got ${gamma}`);
  }
  const out = {} as DirichletCounts;
  for (const c of ML_SERVICE_TYPES) {
    out[c] = gamma * (counts[c] ?? INITIAL_ALPHA_PSEUDOCOUNT);
  }
  if ((ML_SERVICE_TYPES as readonly string[]).includes(actual)) {
    out[actual as MLServiceType] += 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Distribution helpers (over the full 29-class ServiceType space)
// ─────────────────────────────────────────────────────────────────────────

/** Zero-initialised probability distribution over the 29 service types. */
function zeroProbabilities(): ServiceTypeProbabilities {
  const out = {} as ServiceTypeProbabilities;
  for (const st of SERVICE_TYPES) out[st] = 0;
  return out;
}

/**
 * Uniform prior over all 29 service types — the fallback distribution
 * returned when no other information is available. Note: for Bayesian
 * inference we use `initialDirichletCounts()` (uniform over 19 ML
 * classes), not this. This helper exists for cases where we need a
 * 29-class default (e.g., normalise() edge cases).
 */
export function uniformPrior(): ServiceTypeProbabilities {
  const p = 1 / SERVICE_TYPES.length;
  const out = {} as ServiceTypeProbabilities;
  for (const st of SERVICE_TYPES) out[st] = p;
  return out;
}

/**
 * Convert a Dirichlet count vector into a full-29-class probability
 * distribution (fast-path classes = 0). Renormalises defensively.
 */
export function posteriorFromCounts(counts: DirichletCounts): ServiceTypeProbabilities {
  let total = 0;
  for (const c of ML_SERVICE_TYPES) total += counts[c];
  const out = zeroProbabilities();
  if (total <= 0) {
    // Degenerate; return uniform over ML classes only.
    const p = 1 / ML_SERVICE_TYPES.length;
    for (const c of ML_SERVICE_TYPES) out[c] = p;
    return out;
  }
  for (const c of ML_SERVICE_TYPES) out[c] = counts[c] / total;
  return out;
}

/**
 * Renormalise a probability distribution so it sums to 1. Defensive
 * against float drift and degenerate zero-sum inputs (returns uniform).
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
 * Shannon entropy in bits. 0 = certain (one-hot); log2(K) = maximally
 * uncertain (uniform over K classes). Used to visualise posterior
 * concentration over time.
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
// Inference-time blend (unchanged in form from the EMA version)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Combine the decision-tree output with the stored Bayesian posterior for
 * this symptom key.
 *
 *   P_final = (K · P_tree + n · P_prior) / (K + n)
 *
 * where K = TREE_EFFECTIVE_WEIGHT and n is the REAL observation count.
 *
 *   n = 0              → returns P_tree unchanged
 *   n = K (=20)        → 50/50 blend
 *   n → ∞              → asymptotically equal to P_prior
 *
 * Below MIN_OBSERVATIONS_TO_BLEND the prior is considered too noisy to
 * influence dispatch and the tree wins unmodified.
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
  // Sum is 1 by construction (both inputs sum to 1); renormalise anyway
  // to guard against float drift over many stored updates.
  return normalise(out);
}

// ─────────────────────────────────────────────────────────────────────────
// Prediction helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Argmax over a distribution. Ties break by declaration order in
 * SERVICE_TYPES — deterministic, matters for testability.
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
