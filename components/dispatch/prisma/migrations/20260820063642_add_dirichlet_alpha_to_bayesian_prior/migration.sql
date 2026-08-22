-- Add the Dirichlet pseudo-count column for the new Bayesian formulation.
ALTER TABLE "bayesian_priors" ADD COLUMN "alpha" JSONB,
ALTER COLUMN "currentLearningRate" SET DEFAULT 0.99;

-- Clean reset of stored priors. The prior EMA formulation stored a single
-- blended `probabilities` object that is not translatable to the new
-- Dirichlet count vector; rather than back-fill with a lossy conversion,
-- we start every symptom key from a fresh Jeffreys prior on first
-- feedback event (see services/bayesian-engine.ts:initialDirichletCounts).
TRUNCATE TABLE "bayesian_priors";
