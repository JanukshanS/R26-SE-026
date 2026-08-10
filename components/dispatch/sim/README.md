# SimPy Simulation — UADO Dispatch Optimization

Discrete-event simulation of the UADO dispatch pipeline against 3 baselines.
Produces the quantitative results (match rates, resolution times, convergence
curves, paired t-tests) that carry the thesis's empirical claims.

## Run

```
cd components/dispatch
python -m sim.simulate --n 1000 --seed 42 --n-providers 20
```

Outputs land in `sim/outputs/`:

| File | Meaning |
|---|---|
| `dispatch_logs.csv` | one row per (strategy, incident) — full trace |
| `summaries.csv` | one row per strategy — aggregate metrics |
| `convergence.png` | UADO Bayesian entropy vs incident index (thesis figure) |
| `comparison.png` | bar chart, UADO vs 3 baselines on each metric |

## Design

Every strategy sees the SAME incident stream in the SAME order (paired
design). Paired t-tests then measure whether per-incident performance
differences are statistically significant — stronger than mean comparison
across independent samples.

Incidents are generated with a KNOWN ground truth service type drawn from
a distribution that DIFFERS from the tree's training prior. Bayesian's job
is to close that gap using field feedback.

## Strategies

| Strategy | Uses tree? | Uses uncertainty? | Learns? |
|---|---|---|---|
| **UADO** | yes (Tier 1 or 2) | yes (ECM over full distribution) | yes (Bayesian) |
| GreedyNearest | no | no | no |
| TypeMatched | argmax only | no | no |
| MultiCriteria | argmax only | no | no |

## Reproducibility

Seeded RNG throughout. Same `--seed` → identical results across runs. The
tree JSON in `../ml/exported_tree_tier{1,2}.json` is the SAME artefact used
by the TypeScript production runtime — retraining the tree automatically
updates the simulation.

## No side effects

Runs 100% in-memory. Never touches Postgres, never calls the real dispatch
backend, never modifies persistent state. Safe to run in parallel with a
live dispatch service.
