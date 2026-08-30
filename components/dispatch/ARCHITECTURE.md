# UADO — Uncertainty-Aware Dispatch Optimization

**Component of Kaduna.lk — R26-SE-026 (SLIIT Software Engineering, 2026)**
**Author**: Janukshan Sivakumar (IT22635266)

This document describes the design, data lineage, algorithms, and empirical
results of the Dispatch Optimization component of the Kaduna.lk roadside
assistance platform. It is written to support both engineering handover and
the accompanying research paper.

---

## 1. Overview

UADO is a three-stage decision pipeline that turns a stranded driver's
symptom report into a ranked list of service providers to dispatch. It
addresses three problems that naive dispatch systems ignore:

1. **Diagnostic uncertainty** — the driver's report rarely identifies the
   fault with certainty; the system must reason over a probability
   distribution, not a point prediction.
2. **Type-capability matching** — providers are heterogeneous
   (locksmith ≠ tow truck ≠ mobile mechanic); the wrong dispatch wastes
   ~45 minutes on a re-dispatch.
3. **Distributional drift** — the diagnostic model was trained on a finite
   dataset; the true population evolves; the system must self-calibrate
   from post-resolution feedback.

The pipeline is:

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  1. Diagnostic    │    │  2. ECM           │    │  3. Bayesian      │
│     Triage Tree   │───▶│     Optimizer     │───▶│     Feedback Loop │
│  (Tier 1 or 2)    │    │  (Cost function)  │    │  (Prior update)   │
└───────────────────┘    └───────────────────┘    └───────────────────┘
        │                        │                        │
   probability                provider                posterior
   distribution                ranking                  update
   over 19 fault             (argmin cost)         (feeds next dispatch)
   classes
```

Fast-path emergencies (MAJOR_CRASH, FUEL_LEAK, LOCKOUT, ...) short-circuit
the ML tier entirely and route to a hard-coded specialist type — the ML
pipeline exists to disambiguate the *reported ambiguous* cases, not the
obvious ones.

---

## 2. Research Objectives

| SO | Description | Status |
|---|---|---|
| **SO1** | Adaptive symptom questionnaire + ML-derived decision tree | ✅ Complete |
| **SO2** | ECM-based dispatch optimizer with mismatch penalty and traffic externality | ✅ Complete |
| **SO3** | Bayesian posterior update from post-resolution feedback | ✅ Complete |
| **SO4** | OBD-II integration for Tier-2 (sensor-augmented) diagnosis | ✅ Complete (integrated with Predictive Maintenance component) |
| **SO5** | Discrete-event simulation validating UADO against 3 baselines with statistical significance | ✅ Complete |

---

## 3. System Architecture

### 3.1 Deployment topology

The Kaduna.lk platform is composed of four independently-deployed backend
services and one shared mobile app:

```
                    ┌───────────────────────────────────┐
                    │   Mobile App (React Native/Expo)  │
                    │   apps/mobile — dev-client build  │
                    └─────────────────┬─────────────────┘
                                      │ HTTPS + JWT (Supabase)
              ┌───────────────────────┼───────────────────────┬─────────────────────┐
              ▼                       ▼                       ▼                     ▼
    ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
    │  Dispatch (UADO)  │   │ Geo-Intelligence  │   │ Predictive Maint. │   │  Claims Privacy   │
    │  Node.js + TS     │   │  Python + Flask   │   │  Python + Flask   │   │  Python + FastAPI │
    │  PostgreSQL 16    │   │  Redis            │   │                   │   │  R2 storage       │
    │  Port 3001        │   │  Port 5001        │   │  Port 5003        │   │  Port 5002        │
    │  (Janukshan)      │   │  (Asath)          │   │  (Samu)           │   │  (Dilnuk)         │
    └────────┬──────────┘   └────────┬──────────┘   └───────────────────┘   └───────────────────┘
             │                       │
             └────HTTP (traffic)─────┘
```

The dispatch service consumes Asath's Geo-Intelligence service via HTTP
(POST /v1/score) to obtain a real-time traffic-impact score (1-10) used in
the ECM cost function's externality term. The service is optional: when
unreachable, dispatch falls back to a default score of 5, preserving
availability at the cost of a slightly less-informed cost estimate.

### 3.2 Dispatch service internal architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Express + TypeScript (src/index.ts)                                 │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Middleware: helmet, cors, Supabase JWT verification (JWKS)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────┴──────────────────────────────────┐    │
│  │                       Routes                                 │    │
│  │  /health   /incidents   /triage   /providers                 │    │
│  │  /dispatch   /incidents/:id/feedback   /bayesian/*           │    │
│  └───────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────┴──────────────────────────────────┐    │
│  │                      Services                                │    │
│  │  triage-engine    ───▶  decision-tree-engine  (JSON tree)    │    │
│  │        │                                                     │    │
│  │        ▼                                                     │    │
│  │  bayesian-service ───▶  bayesian-engine (pure math)          │    │
│  │        │                                                     │    │
│  │        ▼                                                     │    │
│  │  dispatch-optimizer ──▶ ECM cost function                    │    │
│  │        │                                                     │    │
│  │        ▼                                                     │    │
│  │  geo-client   (fetches traffic score from Asath's service)   │    │
│  └───────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────┴──────────────────────────────────┐    │
│  │                     Persistence                              │    │
│  │  Prisma ORM → PostgreSQL 16 (docker-compose)                 │    │
│  │  Tables: incidents, providers, triage_responses,             │    │
│  │          dispatch_decisions, resolution_feedbacks,           │    │
│  │          bayesian_priors                                     │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.3 Bayesian feedback loop — sequence

```
Time  Driver                Backend                 Provider              Bayesian Store
────  ──────                ───────                 ────────              ──────────────

t0    submit triage    ──▶  runTriageEngine
                            (tree, blend prior)
                              │
                              ├─▶ dispatch to provider
                              │
t1                       ◀─  provider assigned  ◀─  accept

t2                                              ◀─  resolve incident
                              feedback endpoint     ("actual = X")
                              │
                              ├─▶ apply_feedback(symptom_key, X)
                              │                                       ──▶ posterior
                              │                                           updated
                              │                                           obs++
                              │                                           α decayed
                              │
t3    submit similar    ──▶  runTriageEngine
      triage                 (blend prior)
                              │                                       ◀── stored prior
                              │                                           returned
                              ├─▶ P_final = (K·P_tree + n·P_prior)
                              │             / (K + n)
                              ├─▶ tier = BAYESIAN_LEARNED
                              │
                              └─▶ dispatch better provider
```

---

## 4. Data Pipeline & Lineage

### 4.1 Datasets used for training

Four datasets in `ml/new_datasets/` feed the ML pipeline. Every row is
either real field data or expert-validated content — the earlier
proof-of-concept synthetic data has been preserved as the baseline (see
§ 4.3) for the comparison story in the paper but is no longer the
training source.

| File | Provenance | Rows | Role |
|---|---|---|---|
| `questionnaire_dataset_validated.xlsx` | Field-collected questionnaire responses, logic-checked against `automotive_faults.json` + `fault_flowchart.json`, manually validated by expert mechanics | 443 (434 after dropping 2 unsupported classes) | Tier 1 training |
| `obd_dataset.csv` | Real OBD-II sensor readings labelled with resolved service type | 285 (15/class × 19 classes) | Tier 2 training (joined with questionnaire) |
| `automotive_faults.json` | Structured domain knowledge base — fault → symptoms → causes → fix | 300+ fault entries | Validation reference (not training) |
| `fault_flowchart.json` | Expert-derived diagnostic decision flowchart | 25+ decision nodes | Validation reference (not training) |

Two additional datasets are archived for completeness but excluded from
current training:

- `NEV_fault_dataset.csv` — normalized generic EV motor data with binary
  fault labels (0/1). Wrong schema for our 19-class problem; retained as a
  candidate for a future anomaly-detection augmentation.
- `final dataset for kaggle.csv` — real breakdown records with free-text
  labels (e.g., "Brake noise" → "Brake pad replacement"). Used to
  cross-validate class-frequency priors but not directly trained on due
  to taxonomy mismatch.
- `synthetic_telemetry_data.csv` — the original synthetic telemetry from
  the proposal phase. Retained as reference; no longer feeds training.

### 4.2 Preprocessing pipeline (`ml/train_real.py`)

```
1. LOAD
   ├─ questionnaire_dataset_validated.xlsx  (443 rows)
   ├─ obd_dataset.csv                        (285 rows)
   └─ Drop rows with classes ∉ ML_SERVICE_TYPES:
        HYDRO_LOCK (5), ABS_SENSOR_RUST_CORROSION (4)
      → 434 questionnaire rows retained

2. NORMALIZE
   ├─ Missing/blank single-selects → "NOT_ASKED" (the runtime sentinel)
   ├─ Multi-select fields → JSON arrays
   ├─ location_name → location_type (heuristic: hill/coastal keywords)
   └─ vehicle_age_bucket → "3_7" default (not present in real data)

3. JOIN (Tier 2 only)
   For each questionnaire row, sample one OBD row with the same
   service_type (with replacement).
   → 434 joined rows (0 dropped, all classes have OBD coverage)

4. FEATURE ENCODING
   ├─ Categorical singles → one-hot ("Q1_intent=WONT_START" bool)
   ├─ Multi-selects       → indicator columns per option
   └─ OBD numerics        → passed through as float (Tier 2 only)

5. STRATIFIED 80/20 SPLIT
   347 train / 87 holdout, stratified by service_type where possible

6. TRAIN
   DecisionTreeClassifier(random_state=42, min_samples_leaf=1, criterion="gini")

7. EVALUATE
   Holdout accuracy, top-3 accuracy, macro F1, log-loss
   5-fold stratified cross-validation

8. EXPORT
   ├─ Walk sklearn tree → nested JSON (see § 5.1 for format)
   └─ exported_tree_tier{1,2}.json (loaded by the TS runtime at boot)
```

### 4.3 Model version history

| Version | Trained on | Purpose | Runtime file |
|---|---|---|---|
| v0-synthetic | 100 hand-crafted synthetic incidents | Initial proof-of-concept | `exported_tree_tier{1,2}_synthetic.json` (archived) |
| v1-real | 434 validated real questionnaire + 285 real OBD | Current production | `exported_tree_tier{1,2}.json` |

The synthetic tree is preserved for the paper's "before/after" comparison
narrative — one of the paper's contributions is demonstrating that a
research pipeline can be moved from synthetic to real data without
architectural changes.

---

## 5. Algorithms

### 5.1 Diagnostic Decision Tree (SO1)

The runtime loads a sklearn CART decision tree exported to a nested JSON
representation. Each node is either:

```jsonc
// split node
{ "type": "split",
  "feature":   "Q1_intent=WONT_START",   // one-hot categorical or numeric
  "threshold": 0.5,
  "left":  { ... },   // taken when feature_value <= threshold
  "right": { ... },
  "samples": 400 }

// leaf node
{ "type": "leaf",
  "samples": 12,
  "probabilities": { "BATTERY_JUMP": 0.75, "STARTER_MOTOR": 0.25, ... } }
```

**Tier 1** uses only categorical questionnaire features (adaptive fields
plus Sri Lankan context: `location_type`, `recent_rain`, `parked_overnight`,
`vehicle_age_bucket`, `last_fueled`).

**Tier 2** adds continuous OBD-II features (voltage, temperature, RPM, ...)
when a vehicle is paired with an ELM327 dongle via the mobile app.

**Fast-path** is a Q1 intent-picker short-circuit: `LOCKOUT`, `KEY_LOST`,
`FLAT_TIRE`, `FUEL_EMPTY`, `MAJOR_CRASH`, ... map to service types
deterministically without invoking the ML tier. This reflects the reality
that these cases are self-reportable by the driver with certainty.

### 5.2 Expected Cost Minimization Optimizer (SO2)

For each candidate provider *p* and each service type *s* in the
probability distribution *P*:

```
Cost(p) = Σ_s P(s) · [ travel_time(p)
                     + service_time(s)
                     + mismatch_penalty(p, s) ]
        + λ · TrafficImpact
        + (1 − TrustScore(p)) · TRUST_PENALTY
```

where

- `mismatch_penalty(p, s) = RE_DISPATCH_PENALTY` if *p* cannot handle *s*, else 0
- `RE_DISPATCH_PENALTY = 45 minutes` (average time to re-dispatch a second provider)
- `TRUST_PENALTY = 15 minutes` (weight for the trust component)
- `λ = 0.3` (Pigouvian externality weight for traffic impact; sensitivity analysis below)

The chosen provider is `argmin_p Cost(p)`. The formulation integrates over
the full probability distribution rather than committing to `argmax(P)`,
which is the mathematical source of UADO's robustness to tree uncertainty.

### 5.3 Bayesian Feedback Layer (SO3)

**Symptom key** (`utils/symptom-key.ts`) — a canonical hash of five
highest-Gini-importance fields:

```
KEY = SHA1( Q1_intent | Q2_engine_start | Q3_sound |
            Q_brake_detail | Q7_overheat_detail )[:16]
```

Coarse enough that recurrence is frequent (Bayesian actually activates);
fine enough that meaningfully-different patterns don't collide.

**Posterior update** — for each observed resolution outcome:

```
α(n) = max(α_min, α_initial − n · (α_initial − α_min) / W)
P_new = (1 − α) · P_old + α · one_hot(actual)
```

Constants: `α_initial = 0.1`, `α_min = 0.01`, `W = 100`. Linear decay
across the first 100 observations then floors — a stochastic-approximation
schedule that satisfies `Σα = ∞, Σα² < ∞` (Robbins-Monro convergence
conditions).

**Inference-time blend** — every triage output combines the tree with the
symptom key's stored posterior:

```
P_final = (K · P_tree + n · P_prior) / (K + n)
```

with `K = 20` (effective "prior sample count" attributed to the tree) and
*n* = observation count of the stored prior. Below `n < 3` the blend is
suppressed to prevent single-mechanic reports from steering the tree.

This is the closed-form posterior mean of a categorical outcome under a
symmetric Dirichlet prior with concentration *K* — a standard Bayesian
formulation.

---

## 6. Implementation Stack

| Layer | Technology | Rationale |
|---|---|---|
| Mobile client | React Native + Expo (custom dev-client) | Cross-platform + native module support (BLE for OBD) |
| Backend runtime | Node.js + TypeScript + Express | Team familiarity; tight JSON tree integration; JWKS auth via `jsonwebtoken` + `jwks-rsa` |
| Database | PostgreSQL 16 via Prisma ORM | Relational structure fits incident lifecycle; JSON columns for flexible probability payloads |
| Cache/queue | Redis (via docker-compose) | Session state + rate limiting |
| ML training | scikit-learn + pandas + numpy | Standard research stack; deterministic seeded runs |
| Simulation | Custom pure-Python discrete event | No SimPy dep (kept minimal); ~30s for 4000 dispatches |
| Auth | Supabase JWT + JWKS verification | Shared across all 4 components; no shared secret needed |
| Testing | vitest (TS) + pytest-style asserts (Py) | 26 Bayesian unit tests + convergence tests + integration tests |
| Deployment | Contabo VPS with Nginx + sslip.io | Team-owned infrastructure |

---

## 7. Empirical Results

All numbers below are from the reproducible pipeline:
`ml/train_real.py` (training) + `sim/simulate.py` (evaluation).

### 7.1 Diagnostic tree accuracy — 3-way ablation on real data

We evaluate three feature configurations on the same 434-row real dataset
with an identical stratified 80/20 split (`random_state=42`) and identical
`DecisionTreeClassifier` hyperparameters. Only the feature set differs
across runs; test-set rows are byte-identical across all three tiers
(verified programmatically).

| Config | Features used | Holdout Acc | Top-3 Acc | 5-fold CV Acc | Tree depth / leaves |
|---|---|---|---|---|---|
| **OBD-only** (ablation) | 15 numeric OBD PIDs | **31.0%** | 62.1% | 28.6% ± 1.5% | 7 / 25 |
| **Tier 1** (questionnaire only) | 15 categorical Q&A + Sri Lankan context | **47.1%** | 50.6% | 48.8% ± 4.7% | 16 / 154 |
| **Tier 2** (Q + OBD) | Both feature groups combined | **54.0%** | 58.6% | 54.4% ± 4.0% | 17 / 109 |

**Baselines for context**: random guessing over 19 classes = 5.3% top-1
accuracy. Weighted majority-class baseline (predict BATTERY_JUMP always) =
15.0% top-1. All three configurations substantially exceed these.

**Three findings from the ablation**:

1. **OBD-only underperforms questionnaire-only by 16pp** (31.0% vs 47.1%).
   Sensor telemetry alone is insufficient for 19-way fault classification —
   the tree literally cannot grow deep enough to separate the classes,
   maxing out at depth 7 and 25 leaves versus the questionnaire tree's
   depth 16 and 154 leaves. Standard OBD-II Mode 01 PIDs report engine
   physiological state, not root cause; multiple fault classes present
   with identical sensor signatures.

2. **Tier 2 improves on Tier 1 by +6.9pp** (54.0% vs 47.1%), confirming
   OBD data contributes real diagnostic signal — but only as a
   *complement* to the questionnaire, not a substitute.

3. **OBD-only has notably high top-3 accuracy relative to its top-1
   (62.1% vs 31.0%)**. This means the OBD-only tree correctly places
   the truth in its top-3 predictions but cannot decisively pick among
   them — it "knows something is wrong" without narrowing the fix. For a
   dispatch system that must commit to a single service type, this
   uncertainty is actively harmful because the ECM optimizer's provider
   ranking depends on a peaked distribution.

**Answer to "why not just use OBD?"**: OBD-only diagnosis achieves 31.0%
top-1 accuracy, well below questionnaire-only. Sensor telemetry reports
physiological symptoms rather than root causes and is most valuable as a
complement to — not a replacement for — contextual questionnaire data.

Full confusion matrices are in `ml/reports/real_confusion_{tier1,tier2,obd_only}.png`.
The majority of misclassifications are between adjacent fault classes
(e.g., BATTERY_JUMP ↔ BATTERY_REPLACE, RADIATOR_FAN_ISSUE ↔
RADIATOR_HOSE_LEAK) — the same ambiguities an expert mechanic faces
without further inspection.

#### 7.1.1 Worked example — the coolant family

To illustrate why the questionnaire is complementary rather than
redundant, consider the four coolant-family classes: `COOLANT_LOW`,
`RADIATOR_HOSE_LEAK`, `RADIATOR_FAN_ISSUE`, `ENGINE_OVERHEAT_SEVERE`.
All four present with elevated `coolant_temp_c` on the OBD bus, which is
the strongest OBD signal for a cooling problem. Root-cause
disambiguation requires context that only the driver can provide: *when*
does the overheating occur — in traffic, on hills, always, with A/C on?
This information is captured by our `Q7_overheat_detail` field.

Of the 19 true-coolant-family test rows, categorised by prediction outcome:

| Model | Exact class right | Right family, wrong class | Escaped the family entirely |
|---|---|---|---|
| OBD-only | 4 (21.1%) | 8 (42.1%) | **7 (36.8%)** |
| Tier 2 (Q + OBD) | 7 (36.8%) | 11 (57.9%) | **1 (5.3%)** |

**The key statistic is the "escaped" column**: when the true fault is in
the coolant family, OBD-only mispredicts to an unrelated class (e.g.,
`FUEL_PUMP`, `BATTERY_JUMP`) 36.8% of the time. Adding the questionnaire
reduces this to 5.3% — a **7× improvement in family-level
identification**. This validates the "OBD reports symptoms, questionnaire
identifies causes" hypothesis: the coolant temperature reading alone is
not a reliable indicator that a cooling fault is present, because
elevated coolant temperature is a downstream consequence of many
unrelated failure modes (blocked fuel injection, ignition timing, etc.).

Within-family precision also improves (4→7 exact matches), though the
per-class N in the test set is small (2-7 rows per class) and future work
should validate this trend with more data. The 4×4 confusion sub-matrix
is in `ml/reports/real_coolant_family_comparison.png`.

**Runtime deployment note**: the OBD-only tree is retained as a research
artefact (`ml/reports/real_data_metrics.json`) but is **not deployed** to
the TypeScript runtime. Production uses `exported_tree_tier{1,2}.json`
which correspond to Tier 1 and Tier 2 respectively; the runtime selects
tier at inference time based on OBD availability.

### 7.2 SimPy validation — UADO vs 3 baselines

1000 simulated incidents with **known ground truth** drawn from a
distribution DIFFERENT from the tree's training prior (models the reality
that field distributions drift from training samples). Bayesian's job is
to close that gap using per-incident feedback.

| Strategy | Match Rate | Provider Capable Rate | Re-dispatch Rate | Avg Resolution (min) |
|---|---|---|---|---|
| **UADO (full pipeline)** | **39.7%** | **97.6%** | **2.4%** | **65.5** |
| GreedyNearest (closest available) | 35.5% | 69.7% | 30.3% | 77.0 |
| TypeMatched (closest capable) | 27.3% | 92.2% | 7.8% | 67.4 |
| MultiCriteria (weighted score, no uncertainty) | 27.3% | 91.5% | 8.5% | 68.5 |

**Paired t-tests — UADO vs each baseline**:

| Comparison | Metric | t-statistic | p-value | Significant? |
|---|---|---|---|---|
| UADO vs GreedyNearest | resolution time | −19.10 | < 0.0001 | ✅ |
| UADO vs GreedyNearest | match rate | +2.86 | 0.0043 | ✅ |
| UADO vs TypeMatched | resolution time | −6.71 | < 0.0001 | ✅ |
| UADO vs TypeMatched | match rate | +11.58 | < 0.0001 | ✅ |
| UADO vs MultiCriteria | resolution time | −9.43 | < 0.0001 | ✅ |
| UADO vs MultiCriteria | match rate | +11.58 | < 0.0001 | ✅ |

**Headline results for the paper**:
- Match rate: **UADO 39.7% vs 35.5% best baseline** (+11.8% relative)
- Re-dispatch rate: **UADO 2.4% vs 7.8% best baseline** (−69% relative)
- Resolution time: **65.5 vs 67.4 min best baseline** (−2.9%)
- All differences statistically significant at p < 0.005

### 7.3 Bayesian convergence

Mean posterior entropy over UADO's 1000 incidents shows the expected
two-phase dynamic:

1. **Exploration (~0-300 incidents)**: entropy rises as new symptom keys
   are seeded with uniform priors (log₂ 29 ≈ 4.86 bits each).
2. **Consolidation (~300+ incidents)**: entropy decreases from ~2.5 bits
   to ~1.8 bits as posteriors concentrate on their true classes.

Plot: `sim/outputs/convergence.png`. Live demonstration in
`sim/outputs/dispatch_logs.csv` (per-incident entropy).

**Unit-test-level convergence proofs** (`tests/bayesian-engine.test.ts`):

- 200 clean observations under a decayed schedule concentrate the posterior
  mass on the truth from 1/29 (uniform) to > 85%.
- Under 30% noisy observations, `argmax` still converges to the true class
  within 200 observations.

---

## 8. Reproducibility

All results in this document are reproducible from a fresh checkout with a
running Postgres + Redis instance:

```powershell
# 1. Backend
cd components/dispatch
npm install
npm run prisma:generate
docker compose -f ../../docker-compose.yml up -d postgres redis
npm run prisma:migrate deploy
npm run prisma:seed          # 15 seed providers
npm test                     # 56 unit tests

# 2. ML training (deterministic with default seed=42)
cd ml
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python train_real.py          # produces exported_tree_tier{1,2}.json

# 3. Simulation (deterministic with default seed=42)
cd ../sim
python -m sim.simulate --n 1000 --seed 42 --n-providers 20

# 4. End-to-end HTTP demo (requires backend running)
cd ../..
# See docs in dev-notes for the demo PowerShell script.
```

Deterministic behavior is guaranteed by:
- Fixed RNG seeds throughout (`--seed 42` default everywhere)
- Prisma migrations produce identical schema across environments
- The exported tree JSON is a text artifact under version control
- No non-deterministic external calls in the simulation (traffic score
  fixed at 5.0; provider network seeded)

---

## 9. Limitations & Future Work

**Class taxonomy scope**. The runtime supports 19 diagnosable service
types + 10 fast-path types. Two classes present in the real questionnaire
(`HYDRO_LOCK`, `ABS_SENSOR_RUST_CORROSION`, 9 rows total) are dropped
during training. Expanding the runtime catalog is straightforward but
requires a Prisma migration and an updated capability matrix.

**Class balance**. The real questionnaire is imbalanced (`BATTERY_JUMP`:
65 rows vs `SEVERE_MECHANICAL_TOW`: 10 rows). This depresses accuracy on
rare classes. Future work: class weighting, SMOTE-style oversampling for
rare classes, or targeted collection.

**Tier 2 join method**. Since real questionnaire responses and real OBD
readings cover DIFFERENT incidents, Tier 2 pairs them synthetically by
`service_type`. This preserves signal per feature-group but is not a true
joint observation. Future work: instrument a data-collection app that
captures both from the same incident.

**Bayesian activation threshold**. The posterior only influences dispatch
after `n ≥ 3` observations for a symptom pattern (`MIN_OBSERVATIONS_TO_BLEND`).
In a production system with slow feedback velocity, some rare patterns
never activate. Future work: hierarchical Bayesian pooling across related
symptom keys.

**Simulated traffic score**. `sim/simulate.py` uses a fixed traffic score
of 5.0 for reproducibility. Live production reads from the Geo-Intelligence
service. A stochastic-traffic scenario in the simulation is trivial future
work.

**Real-vehicle validation**. Tree accuracy is measured on held-out
questionnaire rows, not on live vehicle diagnostics. A field-test program
with ~10 vehicles and expert-mechanic ground truth is scoped as immediate
next work and would confirm the accuracy numbers transfer to actual
roadside conditions.

---

## 10. Repository Layout

```
components/dispatch/
├── ARCHITECTURE.md              ← this document
├── prisma/
│   ├── schema.prisma            ← DB schema (6 tables)
│   ├── migrations/              ← version-controlled migrations
│   └── seed.ts                  ← 15 sample providers for local dev
├── src/
│   ├── index.ts                 ← Express server entry point
│   ├── config/                  ← env-loaded configuration
│   ├── constants/               ← capability matrix + type constants
│   ├── contracts/               ← inter-service type contracts
│   ├── middleware/
│   │   └── auth.ts              ← Supabase JWT via JWKS
│   ├── routes/
│   │   ├── incident.routes.ts   ← POST/GET /incidents
│   │   ├── triage.routes.ts     ← POST /triage/submit (adaptive form)
│   │   ├── dispatch.routes.ts   ← ECM ranking
│   │   ├── provider.routes.ts   ← CRUD + availability
│   │   └── feedback.routes.ts   ← POST /incidents/:id/feedback + /bayesian/*
│   ├── services/
│   │   ├── triage-engine.ts     ← SO1 orchestrator (fast-path + tree)
│   │   ├── decision-tree-engine.ts  ← JSON tree walker (Tier 1/2)
│   │   ├── bayesian-engine.ts   ← SO3 pure math
│   │   ├── bayesian-service.ts  ← SO3 DB wrapper
│   │   ├── dispatch-optimizer.ts    ← SO2 ECM
│   │   └── geo-client.ts        ← Geo-Intelligence HTTP client
│   ├── types/                   ← shared TypeScript types
│   └── utils/
│       ├── logger.ts            ← winston
│       ├── prisma.ts            ← Prisma client singleton
│       ├── validators.ts        ← Zod schemas
│       └── symptom-key.ts       ← SO3 SHA-1 hashing
├── tests/
│   ├── bayesian-engine.test.ts  ← 20 unit tests including convergence
│   ├── symptom-key.test.ts      ← 6 stability tests
│   ├── geo-client.test.ts       ← Geo-Intel client mocking
│   ├── dispatch-optimize.geo.test.ts  ← ECM integration
│   └── incidents.route.test.ts  ← HTTP smoke
├── ml/
│   ├── new_datasets/            ← real training data (see § 4.1)
│   ├── generate_dataset.py      ← synthetic generator (baseline retained)
│   ├── train_compare.py         ← original DT-vs-RF comparison
│   ├── train_real.py            ← REAL-DATA retraining pipeline (§ 4.2)
│   ├── exported_tree_tier1.json ← Tier 1 runtime artifact
│   ├── exported_tree_tier2.json ← Tier 2 runtime artifact
│   ├── exported_tree_tier{1,2}_synthetic.json  ← baseline for comparison
│   └── reports/                 ← metrics JSON + confusion matrices
└── sim/
    ├── simulate.py              ← main harness
    ├── strategies.py            ← UADO + 3 baselines
    ├── scenario.py              ← incident generator w/ ground truth
    ├── ecm.py                   ← ECM cost function (Python port)
    ├── bayesian.py              ← Bayesian update (Python port)
    ├── tree_walker.py           ← JSON tree evaluator
    ├── metrics.py               ← aggregation + paired t-tests
    ├── plots.py                 ← matplotlib figures
    └── outputs/
        ├── dispatch_logs.csv    ← 4000 rows (per strategy × incident)
        ├── summaries.csv        ← aggregate metrics table
        ├── convergence.png      ← Bayesian entropy over time
        └── comparison.png       ← 4-way strategy comparison bars
```

---

## 11. Citations & Related Work

The following domain sources informed the design:

- **NEV_fault_dataset** — publicly available EV motor telemetry (Kaggle,
  2023). Used as reference for OBD sensor value ranges; not directly
  trained on.
- **`automotive_faults.json`** — internally-curated fault knowledge base
  derived from Bosch Automotive Handbook (10th ed.) chapters on diagnosis
  + Toyota technical service bulletins accessed via public repair manuals.
- **`fault_flowchart.json`** — expert-derived from consultation with two
  Sri Lankan practising mechanics (interview notes in project appendix).

The Bayesian formulation follows Robbins-Monro stochastic approximation
theory (Robbins & Monro, 1951) applied to a Dirichlet-Multinomial
posterior mean.

The ECM formulation extends classical MADM (Multi-Attribute Decision
Making) dispatch approaches (see Bertsimas & Tsitsiklis, Introduction to
Linear Optimization, ch. 12 on stochastic programming) by integrating over
a probability distribution rather than a point estimate.

---

*Document generated 2026-08-11. Last updated 2026-08-16 with 3-way
ablation results (§ 7.1) and coolant-family worked example (§ 7.1.1).
Regenerate after any training run to keep § 7 results current.*
