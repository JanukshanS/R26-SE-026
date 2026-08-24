"""
Reference implementation + validation of the discounted Dirichlet-multinomial
Bayesian update (ARCHITECTURE.md § 5.3), replacing the disproven Robbins-Monro
EMA formulation. Pure Python/NumPy -- port to TypeScript once validated here.

Tests:
1. Posterior consistency at gamma=1 (no discounting): does the posterior
   concentrate on the TRUE class as clean observations accumulate?
2. Noise robustness: does it still concentrate under 30% label noise
   (matching the original EMA test's noise level, for fair comparison)?
3. Adaptivity under drift at gamma=0.99: does it track a CHANGING true
   class, unlike a non-discounted (gamma=1) model which would get stuck?
"""
import numpy as np

RNG_SEED = 42
K = 19  # number of classes

def dirichlet_update(alpha, true_class, gamma, K=K):
    """One observation update: alpha_k <- gamma*alpha_k + 1[k=true_class]"""
    alpha = gamma * alpha
    alpha[true_class] += 1.0
    return alpha

def posterior(alpha):
    return alpha / alpha.sum()

def run_clean_convergence(n_obs=200, alpha_0=0.5, gamma=1.0, true_class=0, seed=42):
    rng = np.random.default_rng(seed)
    alpha = np.full(K, alpha_0)
    history = []
    for i in range(n_obs):
        alpha = dirichlet_update(alpha, true_class, gamma)
        history.append(posterior(alpha)[true_class])
    return history

def run_noisy_convergence(n_obs=200, alpha_0=0.5, gamma=1.0, true_class=0, noise=0.3, seed=42):
    rng = np.random.default_rng(seed)
    alpha = np.full(K, alpha_0)
    history = []
    for i in range(n_obs):
        if rng.random() < noise:
            observed = rng.integers(0, K)  # random wrong class
        else:
            observed = true_class
        alpha = dirichlet_update(alpha, observed, gamma)
        history.append(np.argmax(posterior(alpha)) == true_class)
    return history

def run_drift_adaptivity(n_obs=600, alpha_0=0.5, gamma=0.99, seed=42):
    """First 300 obs: true class = 0. Then drift: true class = 5.
    A correctly-discounting model should track the switch; gamma=1 should not."""
    rng = np.random.default_rng(seed)
    alpha = np.full(K, alpha_0)
    history = []
    for i in range(n_obs):
        true_class = 0 if i < 300 else 5
        alpha = dirichlet_update(alpha, true_class, gamma)
        history.append(posterior(alpha))
    return history

print("=== TEST 1: Clean convergence (gamma=1, no discounting) ===")
h = run_clean_convergence(n_obs=200, gamma=1.0)
print(f"Posterior mass on true class after 200 clean observations: {h[-1]:.3f}")
print(f"(uniform prior was 1/{K} = {1/K:.3f}; target from old EMA test: >85%)")
print(f"PASS: {h[-1] > 0.85}")
print()

print("=== TEST 2: Noise robustness (30% label noise, gamma=1) ===")
h = run_noisy_convergence(n_obs=200, noise=0.30, gamma=1.0)
converged_by_200 = h[-1]
first_stable_convergence = next((i for i in range(len(h)-20) if all(h[i:i+20])), None)
print(f"Argmax correct at observation 200: {converged_by_200}")
print(f"First point of stable (20-obs sustained) convergence: obs #{first_stable_convergence}")
print(f"PASS (converges by 200 obs, matching old EMA test claim): {converged_by_200}")
print()

print("=== TEST 3: Adaptivity under drift (gamma=0.99, ESS~100) ===")
hist = run_drift_adaptivity(n_obs=600, gamma=0.99)
p_true_before_drift = hist[299][0]   # P(class 0) right before drift at obs 300
p_new_at_350 = hist[349][5]           # P(class 5) 50 obs after drift
p_new_at_450 = hist[449][5]           # P(class 5) 150 obs after drift
p_old_at_450 = hist[449][0]           # P(class 0, the stale class) 150 obs after drift
print(f"P(class 0) just before drift (obs 300): {p_true_before_drift:.3f}")
print(f"P(class 5, the NEW true class) 50 obs after drift:  {p_new_at_350:.3f}")
print(f"P(class 5, the NEW true class) 150 obs after drift: {p_new_at_450:.3f}")
print(f"P(class 0, the STALE class) 150 obs after drift:    {p_old_at_450:.3f}")
print(f"PASS (adapts to drift, new class dominates by obs 450): {p_new_at_450 > p_old_at_450}")
print()

print("=== COMPARISON: gamma=1.0 (no discount) under the SAME drift scenario ===")
hist_no_discount = run_drift_adaptivity(n_obs=600, gamma=1.0)
p_new_nodiscount_450 = hist_no_discount[449][5]
p_old_nodiscount_450 = hist_no_discount[449][0]
print(f"P(class 5, NEW) 150 obs after drift, gamma=1: {p_new_nodiscount_450:.3f}")
print(f"P(class 0, STALE) 150 obs after drift, gamma=1: {p_old_nodiscount_450:.3f}")
print(f"Without discounting, old evidence never gets forgotten -- ")
print(f"demonstrates WHY gamma=0.99 (not gamma=1) is the right choice for a ")
print(f"production system facing real distributional drift.")
