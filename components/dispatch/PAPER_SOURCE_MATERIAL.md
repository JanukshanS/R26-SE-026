# UADO — Source Material for Research Paper

**Purpose of this document**: A complete, code-verified extraction of the Dispatch
Optimization (UADO) component of Kaduna.lk, for use by any agent/collaborator
drafting the research paper, generating architecture diagrams, or writing the
methodology/results sections. Every number, formula, and file path below was
either read directly from source on 2026-08-15 or re-derived by re-running the
actual pipeline — not copied from a stale doc. Where a discrepancy was found
between docs and code, both are reported and the authoritative source is
stated explicitly (see §9).

**Component**: Dispatch Optimization ("UADO" — Uncertainty-Aware Dispatch
Optimization), one of 4 components of Kaduna.lk (R26-SE-026, SLIIT SE 2026).
**Author**: Janukshan Sivakumar (IT22635266).
**Repo path**: `components/dispatch/`

---

## ⚠ 0. STALENESS NOTICE (added 2026-08-25 — read before trusting §4.3/§5)

Three commits landed on this branch after the original 2026-08-15 extraction
below: `79d5a16` (OBD-only ablation), `2687cd7` ("v3 pipeline: Dirichlet
Bayesian, real-only retrain, ECMOnly ablation, 30-seed McNemar protocol"),
and `5215c2c`/`51a7138` (merge + unrelated dashboard rename). This means:

- **§4.3's Bayesian formula is SUPERSEDED.** The linear-blend/EMA update
  (`P_new = (1-α)P_old + α·one_hot(actual)`) has been replaced by a proper
  **discounted Dirichlet-multinomial conjugate update**
  (`ml/files/dirichlet_bayesian.py`, ported into `bayesian-engine.ts` /
  `bayesian-service.ts` — 295 and 172 lines changed respectively). The
  source comment literally states this replaces "the disproven Robbins-Monro
  EMA formulation" — i.e., the team found the old formula's convergence
  claim didn't hold and fixed it. Core update rule is now:
  `α_k ← γ·α_k + 1[k=true_class]`, `P(k) = α_k / Σα`, with `γ` (gamma) as a
  discount factor for handling distributional drift (`γ=0.99` tracks drift,
  `γ=1.0` = no discounting). **The exact production constants (which γ is
  deployed, whether K/blend-weight semantics changed) were not
  re-extracted — read `bayesian-engine.ts` and `bayesian-service.ts` fresh
  before writing the Bayesian methodology section.**
- **§5.4's ML numbers are SUPERSEDED.** `ml/train_real.py` (v1-real) was
  replaced by `ml/train_v3.py` as the pipeline that produces the currently
  deployed `exported_tree_tier{1,2}.json`. v3 adds synthetic-data
  augmentation to the TRAINING fold while holding out a 100%-real test set
  (`split_real_only_holdout`) — a materially better evaluation methodology
  than v1. **New, verified v3 accuracy is substantially higher than the v1
  numbers in §5.4**: see §13 below for the full v3 calibration numbers,
  which include a fresh accuracy readout (Tier 1 64.4%, Tier 2 69.0% vs
  v1's 47.1%/54.0%). §5.4 has not been fully rewritten — treat its DT/RF
  accuracy table as historical (v1), not current.
- **The §6.3 "reproducibility mystery" is now explained** — see the closing
  note appended to §6.3 below. It was never a code-nondeterminism bug; the
  repo's tree artifacts and simulation code were genuinely being modified by
  the author between my checks (commits landing mid-session), which is why
  identical commands produced different numbers at different points in
  time. Hash-seed and stale-bytecode were tested and ruled out as causes —
  see the transcript around 2026-08-25 for the empirical tests.
- **§14 and §15 (below) are new** — calibration evaluation and an ECM
  ablation, both computed fresh against current code on 2026-08-25.
- **Recommendation**: before finalizing the paper, run a fresh full
  extraction pass (repeat the method used to build this document) rather
  than patching around these notices indefinitely — the core algorithm
  (Bayesian layer) changed, which affects the Methodology section, not just
  a numbers table.

---

## 1. Problem Framing

UADO is a three-stage decision pipeline that turns a stranded driver's symptom
report into a ranked list of service providers to dispatch. It targets three
problems naive dispatch systems ignore:

1. **Diagnostic uncertainty** — the driver's report rarely identifies the
   fault with certainty; the system must reason over a probability
   distribution, not a point prediction.
2. **Type-capability matching** — providers are heterogeneous (locksmith ≠
   tow truck ≠ mobile mechanic); a wrong dispatch wastes ~45 minutes on a
   re-dispatch.
3. **Distributional drift** — the diagnostic model is trained on a finite
   dataset; the true population evolves; the system must self-calibrate from
   post-resolution feedback.

Pipeline: `Diagnostic Triage Tree (Tier 1/2) → ECM Optimizer (cost function)
→ Bayesian Feedback Loop (prior update, feeds next dispatch)`.

Fast-path emergencies (lockout, flat tire, fuel empty, major accident, ...)
short-circuit the ML tier entirely and route to a hard-coded specialist type —
the ML pipeline exists to disambiguate genuinely ambiguous cases, not obvious
ones.

---

## 2. Research Objectives (SO1–SO5)

| SO | Description | Status |
|---|---|---|
| SO1 | Adaptive symptom questionnaire + ML-derived decision tree | Complete |
| SO2 | ECM-based dispatch optimizer with mismatch penalty + traffic externality | Complete |
| SO3 | Bayesian posterior update from post-resolution feedback | Complete |
| SO4 | OBD-II integration for Tier-2 (sensor-augmented) diagnosis | Complete (real OBD dataset now used, see §5) |
| SO5 | Discrete-event simulation validating UADO against 3 baselines with statistical significance | Complete |

---

## 3. System Architecture

### 3.1 Deployment topology (Kaduna.lk platform)

```
                    ┌───────────────────────────────────┐
                    │   Mobile App (React Native/Expo)  │
                    └─────────────────┬─────────────────┘
                                      │ HTTPS + JWT (Supabase)
              ┌───────────────────────┼───────────────────────┬─────────────────────┐
              ▼                       ▼                       ▼                     ▼
    ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
    │  Dispatch (UADO)  │   │ Geo-Intelligence  │   │ Predictive Maint. │   │  Claims Privacy   │
    │  Node.js + TS     │   │  Python + Flask   │   │  Python + Flask   │   │  Python + FastAPI │
    │  PostgreSQL 16     │   │  Redis            │   │                   │   │  R2 storage       │
    │  Port 3001         │   │  Port 5001        │   │  Port 5003        │   │  Port 5002        │
    └────────┬──────────┘   └────────┬──────────┘   └───────────────────┘   └───────────────────┘
             │                       │
             └────HTTP (traffic)─────┘
```

Dispatch calls Geo-Intelligence's `POST /v1/score` to get a real-time
traffic-impact score (1–10) for the ECM cost function's externality term.
The call is optional: on timeout/failure/unreachable, dispatch falls back to
a default score of 5 (never hard-fails on this dependency). Timeout = 2000ms
(`AbortSignal.timeout(2000)` in `src/services/geo-client.ts`).

### 3.2 Dispatch service internal architecture

```
Express + TypeScript (src/index.ts)
  Middleware: helmet, cors, Supabase JWT verification via JWKS (no shared secret — verifies against Supabase's public JWKS endpoint)
       │
  Routes: /health  /incidents  /triage  /providers  /dispatch  /incidents/:id/feedback  /bayesian/*
       │
  Services:
    triage-engine ──▶ decision-tree-engine (loads/walks JSON tree)
         │
         ▼
    bayesian-service ──▶ bayesian-engine (pure math, no DB/side effects)
         │
         ▼
    dispatch-optimizer ──▶ ECM cost function
         │
         ▼
    geo-client (fetches traffic score from Geo-Intelligence)
       │
  Persistence: Prisma ORM → PostgreSQL 16
    Tables: incidents, providers, triage_responses, dispatch_decisions,
            resolution_feedbacks, bayesian_priors
```

### 3.3 Bayesian feedback loop — sequence

```
t0  Driver submits triage ──▶ runTriageEngine (tree) ──▶ blendTriageWithPrior
                                                              │
                                                              ├─▶ dispatch to provider
t1  Provider assigned
t2  Provider resolves incident ("actual = X")
        ──▶ POST /incidents/:id/feedback
              ├─▶ applyFeedback(symptomKey, X)  →  posterior updated, obs++, α decayed
              └─▶ provider trustScore recomputed
t3  Next similar incident's triage ──▶ tree result blended with the now-updated
                                        stored prior: P_final = (K·P_tree + n·P_prior)/(K+n)
                                        tier reported as BAYESIAN_LEARNED
```

### 3.4 Request/response flow for a full incident lifecycle

1. `POST /api/v1/incidents` — create incident (location, vehicle info) → status `CREATED`
2. `GET /api/v1/triage/questions` — adaptive form schema (branching rules) for the client
3. `POST /api/v1/triage/submit` — run triage engine (tree + Bayesian blend), persist `TriageResponse`, incident → `DISPATCHING`
4. `POST /api/v1/dispatch/optimize` — run ECM optimizer over available providers, persist ranked `DispatchDecision` rows, incident → `PROVIDER_ASSIGNED`
5. `POST /api/v1/dispatch/respond` — provider accept/decline (currently returns 501 — not yet implemented, "Phase 5" placeholder)
6. `POST /api/v1/incidents/:incidentId/feedback` — post-resolution report → updates `ResolutionFeedback`, Bayesian posterior, provider trust score, incident → `RESOLVED`

---

## 4. Core Algorithms

### 4.1 Diagnostic Triage (SO1)

**Source**: `src/services/triage-engine.ts`, `src/services/decision-tree-engine.ts`

**Fast-path short-circuit**: If the driver's `Q1_intent` answer is one of 10
fast-path intents (`LOCKOUT`, `KEY_LOST`, `FLAT_TIRE`, `FUEL_EMPTY`,
`FUEL_WRONG`, `MAJOR_CRASH`, `FUEL_LEAK_FIRE_RISK`, `LIGHT_BULB`,
`BLOWN_FUSE`, `STUCK_FLOOD`), the engine skips ML inference entirely and
returns probability 1.0 on the deterministically-mapped service type. No
tree, no Bayesian, entropy = 0.

**ML path (adaptive questionnaire)**: 5 remaining Q1 intents
(`WONT_START`, `ENGINE_PROBLEM`, `WEIRD_BEHAVIOR`, `BRAKE_ISSUE`,
`GEAR_ISSUE`) branch into an adaptive form (only relevant follow-up
questions shown — see full question tree in §4.1.1) that terminates in a
19-class decision tree prediction.

**Tiering**:
- **Tier 1** (`QUESTIONNAIRE_ONLY`): categorical questionnaire features only.
- **Tier 2** (`OBD_ENHANCED`): adds continuous OBD-II telemetry (voltage,
  temperature, RPM, etc.) — selected automatically when `obdData.available === true`.

**Tree format** (JSON, exported by scikit-learn, walked by TS at request time):
```jsonc
// split node — sklearn convention: value <= threshold → LEFT, else RIGHT
{ "type": "split", "feature": "Q1_intent=WONT_START", "threshold": 0.5,
  "left": {...}, "right": {...}, "samples": 400 }
// leaf node
{ "type": "leaf", "samples": 12,
  "probabilities": { "BATTERY_JUMP": 0.75, "STARTER_MOTOR": 0.25 } }
```
Feature encoding: `"<colName>=<VALUE>"` → 1.0 if categorical field matches
(or, for multi-select, contains the value), else 0.0. Bare `"<rawColName>"`
→ numeric passthrough (OBD fields). Skipped questionnaire fields are encoded
as the literal string `"NOT_ASKED"`, itself a valid trained category (not a
null/missing sentinel — the tree was trained to treat it as its own class).

Confidence = `1 - entropy / log2(19)` (normalized). Trees are cached in
memory after first load (`decision-tree-engine.ts:treeCache`).

#### 4.1.1 Adaptive questionnaire structure

Entry point **Q1 — intent picker** (15 options across 2 cohorts):

- ML-engaging (5): `WONT_START`, `ENGINE_PROBLEM`, `WEIRD_BEHAVIOR` →
  Q2_engine_start; `BRAKE_ISSUE` → Q_brake_detail; `GEAR_ISSUE` → Q_gear_detail
- Fast-path (10, listed above) — form ends immediately, deterministic dispatch

Branching single-selects (each shown conditionally on a prior answer):

| Question | Trigger | Options |
|---|---|---|
| Q2_engine_start | Q1 ∈ {WONT_START, ENGINE_PROBLEM, WEIRD_BEHAVIOR} | STARTS_NORMAL, STARTS_BUT_ISSUE, CRANKS_NO_START, NO_CRANK |
| Q2b_running_issue | Q2 ∈ {STARTS_NORMAL, STARTS_BUT_ISSUE} | OVERHEATING, NOISE, NO_POWER, SMOKE, STALLING |
| Q3_sound | Q2 = CRANKS_NO_START | RAPID_CLICKING, SINGLE_CLICK, NORMAL_CRANKING, GRINDING, NOTHING, WHIRRING |
| Q3b_electrical | Q2 = NO_CRANK | ALL_DEAD_NO_LIGHTS, DIM_LIGHTS, SOME_LIGHTS_ON |
| Q4_noise_detail | Q2b = NOISE | SQUEAL, KNOCK, GRIND, WHINE, CLUNK |
| Q7_overheat_detail | Q2b = OVERHEATING | TRAFFIC_ONLY, ALWAYS, HILL_CLIMB, WITH_AC |
| Q8_smoke_color | Q2b = SMOKE | WHITE, BLUE_GREY, BLACK, ELECTRICAL_BURNING (marked CRITICAL urgency) |
| Q_brake_detail | Q1 = BRAKE_ISSUE | SQUEALING, GRINDING, PULL_ONE_SIDE, SOFT_PEDAL (CRITICAL) |
| Q_gear_detail | Q1 = GEAR_ISSUE | SLIPPING, WONT_ENGAGE, GRINDING, CLUTCH_SOFT |

Always-asked tail: Q5_lights (10-option multi-select of dashboard warning
lamps), Q6_smells (6-option single-select), Q9_recent (7-option multi-select
of recent warning signs), plus 5 Sri-Lanka-context fields always asked:
`location_type` (COASTAL/HILL/URBAN/RURAL), `recent_rain` (NONE/YESTERDAY/
WITHIN_3_DAYS/MONSOON), `parked_overnight` (INDOOR/OUTDOOR),
`vehicle_age_bucket` (UNDER_3/3_7/8_15/OVER_15), `last_fueled`
(TODAY_NEW_STATION/TODAY_USUAL/WITHIN_WEEK/OVER_WEEK).

Full schema source: `src/routes/triage.routes.ts` (`GET /triage/questions`),
type definitions in `src/types/index.ts`.

### 4.2 Expected Cost Minimization (ECM) Optimizer (SO2)

**Source**: `src/services/dispatch-optimizer.ts` (production TS),
`sim/ecm.py` (verified identical Python port used in simulation).

For each candidate provider *p*, integrated over the full probability
distribution *P* returned by triage (not just the argmax):

```
Cost(p) = Σ_s P(s) · [ travel_time(p) + service_time(s) + mismatch_penalty(p,s) ]
        + λ · trafficImpactScore
        + (1 − trustScore(p)) · TRUST_PENALTY
```
where:
- `travel_time(p)` = Haversine great-circle distance / 25 km/h (Colombo
  urban traffic average placeholder; production code comments note this is
  meant to be replaced by Google Maps Distance Matrix API)
- `mismatch_penalty(p,s) = RE_DISPATCH_PENALTY_MINUTES` (45 min) if provider
  *p* cannot handle service type *s* (per the capability matrix, §7.2),
  else 0
- `λ = 0.3` (traffic externality weight, `TRAFFIC_LAMBDA` / `trafficLambda`)
- `TRUST_PENALTY = 15` minutes
- `trustScore(p)` clamped to [0.1, 1.0] in the TS implementation (division
  guard); Python simulation port applies it as a flat additive penalty term
  instead of a divisor — **note**: the TS production formula divides total
  raw cost by trust (`totalCost = rawCost / clampedTrust`), while the
  simulation's `ecm.py` instead *adds* `(1 - trust) * TRUST_PENALTY_MINUTES`.
  These are two different mathematical treatments of the same trust concept
  and are **not numerically identical** — flag this for the methodology
  section if exact algorithmic equivalence between the production system and
  the simulation is claimed. (Both converge to "lower trust → higher cost.")

Selected provider = `argmin_p Cost(p)`. The chosen ranking is persisted per
incident as `DispatchDecision` rows (one per evaluated provider, with a
`costBreakdown` JSON column: `expectedServiceCost`, `expectedMismatchCost`,
`trafficExternalityCost`, `trustAdjustment`, `totalCost`).

Average service times per service type (minutes) — full table in `src/config/index.ts`:

| Service type | Minutes | Service type | Minutes |
|---|---|---|---|
| BATTERY_JUMP | 15 | BRAKE_PAD_WORN | 60 |
| BATTERY_TERMINAL_CLEAN | 10 | BRAKE_FAILURE | 90 |
| BATTERY_REPLACE | 30 | CLUTCH_WORN | 150 |
| ALTERNATOR_ISSUE | 60 | TRANSMISSION_ISSUE | 180 |
| STARTER_MOTOR | 60 | SEVERE_MECHANICAL_TOW | 30 (tow only) |
| COOLANT_LOW | 10 | LOCKOUT | 15 |
| RADIATOR_FAN_ISSUE | 45 | KEY_LOST | 30 |
| RADIATOR_HOSE_LEAK | 30 | FLAT_TIRE_CHANGE | 15 |
| ENGINE_OVERHEAT_SEVERE | 120 | FUEL_EMPTY | 15 |
| BELT_BROKEN | 30 | FUEL_WRONG | 45 |
| FUEL_FILTER_CLOGGED | 25 | LIGHT_BULB | 15 |
| FUEL_PUMP | 90 | BLOWN_FUSE | 10 |
| IGNITION_SYSTEM | 60 | MAJOR_ACCIDENT | 30 |
| ELECTRICAL_FAULT_RAIN | 90 | URGENT_TOW | 30 |
| | | FLOOD_RECOVERY | 60 |

### 4.3 Bayesian Feedback Layer (SO3)

**Source**: `src/services/bayesian-engine.ts` (pure functions, unit-tested),
`src/services/bayesian-service.ts` (Prisma DB wrapper), `src/utils/symptom-key.ts`.

**Symptom key**: a canonical SHA-1 hash (first 16 hex chars, prefixed `sk_`)
of 5 highest-Gini-importance fields, chosen deliberately coarse so recurrence
is frequent enough for the posterior to accumulate observations within a
research timeframe:
```
KEY = SHA1( Q1_intent | Q2_engine_start | Q3_sound | Q_brake_detail | Q7_overheat_detail )[:16]
```
`NOT_ASKED` is preserved verbatim in the key (a skipped question is a
distinct pattern from an answered one).

**Learning-rate schedule** — linear decay then floor:
```
α(n) = max(α_min, α_initial − n·(α_initial − α_min)/W)
```
Constants: `α_initial = 0.1`, `α_min = 0.01`, `W = 100` (`INITIAL_LEARNING_RATE`,
`MIN_LEARNING_RATE`, `LEARNING_WINDOW_SIZE` in `src/config/index.ts`). This
is a stochastic-approximation schedule satisfying Robbins-Monro convergence
conditions (Σα = ∞, Σα² < ∞) for practical N.

**Posterior update** (applied on every `POST /incidents/:id/feedback`):
```
P_new = (1 − α)·P_old + α·one_hot(actual)
```
`P_old` starts as the uniform distribution (`uniformPrior()`, 1/29 per class)
the first time a symptom key is observed.

**Inference-time blend** — every triage response is combined with the
symptom key's stored posterior before being handed to the ECM optimizer:
```
P_final = (K·P_tree + n·P_prior) / (K + n)
```
`K = TREE_EFFECTIVE_WEIGHT = 20` (effective "prior sample count" attributed
to the tree — at `n = K` observations the blend is 50/50; as `n → ∞` the
blend asymptotically equals the learned posterior). Below
`MIN_OBSERVATIONS_TO_BLEND = 3` observations, blending is suppressed
entirely and the tree output passes through unmodified (prevents one noisy
report from steering dispatch). This is the closed-form posterior mean of a
categorical outcome under a symmetric Dirichlet prior with concentration *K*.

**Shannon entropy** (bits) reported alongside every prediction and used as
the convergence-proof metric:
```
H(P) = − Σ_k P(k)·log2(P(k))
```
0 = certain (delta on one class); `log2(29) ≈ 4.86` = maximally uncertain
(uniform over all 29 service types, though Bayesian only ever fires on the
19 ML-diagnosable classes since fast-path bypasses triage).

**Concurrency safety**: `applyFeedback` uses a Prisma `SERIALIZABLE`
transaction (read-modify-write of the same symptom key from two concurrent
feedback reports cannot race/clobber).

**Unit-tested convergence properties** (`tests/bayesian-engine.test.ts`, 252
lines): 200 clean observations under the decayed schedule concentrate
posterior mass on the true class from 1/29 (uniform) to >85%. Under 30%
noisy observations, argmax still converges to the true class within 200
observations.

---

## 5. Data & ML Pipeline

### 5.1 Datasets

**Currently used for training** (`ml/new_datasets/`) — real, expert-validated data:

| File | Provenance | Rows | Role |
|---|---|---|---|
| `questionnaire_dataset_validated.xlsx` | Field-collected Q&A, logic-checked against `automotive_faults.json` + `fault_flowchart.json`, validated by expert mechanics | 443 (434 after dropping 2 unsupported classes) | Tier 1 training |
| `obd_dataset.csv` | Real OBD-II sensor readings labelled with resolved service type | 285 (15/class × 19 classes) | Tier 2 training (joined with questionnaire by service_type) |
| `automotive_faults.json` | Structured domain knowledge base — fault → symptoms → causes → fix | 300+ entries | Validation reference (not trained on) |
| `fault_flowchart.json` | Expert-derived diagnostic decision flowchart | 25+ decision nodes | Validation reference (not trained on) |

Archived, not currently trained on:
- `NEV_fault_dataset.csv` — public EV motor telemetry (Kaggle, 2023), binary
  fault labels; wrong schema for the 19-class problem.
- `final dataset for kaggle.csv` — real breakdown records, free-text labels;
  taxonomy mismatch, used only to cross-validate class-frequency priors.
- `synthetic_telemetry_data.csv` — original proposal-phase synthetic
  telemetry; superseded by real OBD data but retained as reference.

**Two dropped classes**: `HYDRO_LOCK` (5 rows), `ABS_SENSOR_RUST_CORROSION`
(4 rows) — present in the real questionnaire dataset but not modelled by the
current 19-class runtime catalog. 9 rows total (2.0% of dataset) dropped
during training rather than silently remapped.

### 5.2 Preprocessing pipeline (`ml/train_real.py`)

```
1. LOAD questionnaire (443 rows) + OBD (285 rows); drop 9 unsupported-class rows → 434 retained
2. NORMALIZE — missing single-selects → "NOT_ASKED"; multi-selects → JSON
   arrays; location_name → location_type via keyword heuristic
   (hill: KANDY/NUWARA/BADULLA/HATTON/ELLA; coastal: GALLE/MATARA/NEGOMBO/
   BENTOTA/HIKKADUWA/MOUNT LAVINIA/MORATUWA; else URBAN);
   vehicle_age_bucket defaulted to "3_7" (not present in source data)
3. JOIN (Tier 2 only) — each questionnaire row paired WITH REPLACEMENT to a
   randomly-sampled OBD row sharing its service_type → 434 joined rows
   (0 dropped; every class has ≥1 OBD row)
4. FEATURE ENCODING — categorical singles → one-hot; multi-selects →
   indicator columns; OBD numerics → float passthrough (Tier 2 only)
5. STRATIFIED 80/20 SPLIT — 347 train / 87 holdout
6. TRAIN — DecisionTreeClassifier(random_state=42, min_samples_leaf=1, criterion="gini")
7. EVALUATE — holdout accuracy, top-3 accuracy, macro F1, log-loss, 5-fold stratified CV
8. EXPORT — sklearn tree walked into nested JSON → exported_tree_tier{1,2}.json
```

### 5.3 Model choice justification

Decision Tree (primary, deployed) vs Random Forest (comparison-only
baseline, not deployed): DT chosen for interpretability/exportability to
JSON for the TS runtime, and audit-friendliness for PDPA-compliant dispatch
decisions where every prediction must be traceable to a path of feature
splits. RF is evaluated purely as an "ML accuracy ceiling" to show how much
accuracy is traded away for interpretability.

### 5.4 Empirical ML results

**⚠ Two distinct result sets exist — do not conflate them:**

**(A) REAL DATA — current production trees** (authoritative;
`ml/reports/real_data_metrics.json`, confirmed matches `ARCHITECTURE.md`):

| Model | N train/test | Holdout Acc | Top-3 Acc | Macro F1 | 5-fold CV Acc | Tree depth | Leaves |
|---|---|---|---|---|---|---|---|
| Tier 1 (questionnaire only) | 347/87 | **47.1%** | 50.6% | 0.425 | 48.8% ± 4.7% | 16 | 154 |
| Tier 2 (questionnaire + OBD) | 347/87 | **54.0%** | 58.6% | 0.525 | 54.4% ± 4.0% | 17 | 109 |

Baseline for context: random guessing over 19 classes = 5.3% top-1. Weighted
majority-class baseline (always predict BATTERY_JUMP) = 15.0% top-1. Both
tiers substantially exceed both baselines. **Tier 2 vs Tier 1 gain: +6.9
percentage points holdout accuracy, +5.6pp CV** — the OBD signal adds real
diagnostic value.

Confusion matrices: `ml/reports/real_confusion_tier{1,2}.png`. Most
misclassifications occur between adjacent fault classes (BATTERY_JUMP ↔
BATTERY_REPLACE, RADIATOR_FAN_ISSUE ↔ RADIATOR_HOSE_LEAK).

**(B) SYNTHETIC DATA — original proof-of-concept baseline, archived**
(`ml/reports/tier1/metrics.json`, `ml/reports/tier2/metrics.json`; trees now
saved separately as `exported_tree_tier{1,2}_synthetic.json`, no longer
loaded by the runtime):

| Model | Tier 1 Acc / Top-3 | Tier 1 Macro F1 | Tier 2 Acc / Top-3 | Tier 2 Macro F1 |
|---|---|---|---|---|
| Decision Tree (100 synthetic incidents, n_train=400/n_test=100) | 49.0% / 71.0% | 0.459 | 50.0% / 84.0% | 0.462 |
| Random Forest (n_estimators=200, comparison only) | 67.0% / 95.0% | 0.599 | 68.0% / 96.0% | 0.609 |

**Narrative use**: one of the paper's contributions is demonstrating the
pipeline moved from a synthetic proof-of-concept to real field/expert data
without architectural changes — same feature encoding, same export format,
same TS runtime consumer. The real-data DT numbers (47.1%/54.0%) are LOWER
than the synthetic DT numbers (49.0%/50.0%) on raw accuracy — expected and
worth stating plainly: synthetic data was generated from the same
conditional-answer templates the tree would later learn (easier, "trained on
its own generator's assumptions"), whereas real data has genuine field noise,
class imbalance, and human-validated ambiguity. The RF numbers in set (B) are
a synthetic-data-only ceiling estimate and were not re-run on real data (no
real-data RF comparison currently exists — worth noting as a gap/future work
item if the paper needs a real-data RF baseline too).

### 5.5 Class taxonomy

29 total service types = 19 ML-diagnosable + 10 fast-path.

**ML-diagnosable (19)**: BATTERY_JUMP, BATTERY_TERMINAL_CLEAN,
BATTERY_REPLACE, ALTERNATOR_ISSUE, STARTER_MOTOR, COOLANT_LOW,
RADIATOR_FAN_ISSUE, RADIATOR_HOSE_LEAK, ENGINE_OVERHEAT_SEVERE, BELT_BROKEN,
FUEL_FILTER_CLOGGED, FUEL_PUMP, IGNITION_SYSTEM, ELECTRICAL_FAULT_RAIN,
BRAKE_PAD_WORN, BRAKE_FAILURE, CLUTCH_WORN, TRANSMISSION_ISSUE,
SEVERE_MECHANICAL_TOW.

**Fast-path (10)**: LOCKOUT, KEY_LOST, FLAT_TIRE_CHANGE, FUEL_EMPTY,
FUEL_WRONG, LIGHT_BULB, BLOWN_FUSE, MAJOR_ACCIDENT, URGENT_TOW, FLOOD_RECOVERY.

**Provider types (5)**: MOBILE_MECHANIC, FUEL_DELIVERY, LOCKSMITH, TOW_LIGHT,
TOW_HEAVY.

**Capability matrix** (which provider type can handle which service type —
full detail in `src/constants/capability-matrix.ts`):
- MOBILE_MECHANIC: on-scene fixable only (battery work, belts, fluids, fuel
  filter, sensor/ignition, bulbs/fuses, flat tire) — cannot tow.
- FUEL_DELIVERY: FUEL_EMPTY, FUEL_WRONG only.
- LOCKSMITH: LOCKOUT, KEY_LOST only.
- TOW_LIGHT: most passenger-car mechanical issues (tows to garage) + on-scene
  jump/tire-change.
- TOW_HEAVY: superset of TOW_LIGHT + SEVERE_MECHANICAL_TOW, MAJOR_ACCIDENT,
  URGENT_TOW, FLOOD_RECOVERY.

Mismatch risk for a provider = `Σ P(type_k)` over all `type_k` the provider
cannot handle (`calculateMismatchRisk` in capability-matrix.ts) — this is the
quantity the ECM formula penalizes via `mismatch_penalty`.

---

## 6. Simulation & Validation (SO5)

**Source**: `sim/` — pure-Python discrete-event-style simulation (no SimPy
dependency — deliberately minimal; ~30s for 4000 dispatches). Files:
`simulate.py` (harness), `strategies.py` (4 policies), `scenario.py`
(incident generator), `ecm.py` (Python port of the cost function),
`bayesian.py` (Python port of the Bayesian engine), `tree_walker.py` (JSON
tree evaluator), `metrics.py` (aggregation + paired t-tests), `plots.py`.

### 6.1 Design

**Paired design**: every strategy sees the SAME incident stream in the SAME
order, enabling per-incident paired t-tests (stronger than independent-sample
mean comparison).

**The "truth drift" trick** (`scenario.py`): the tree is trained on
`P_train` (the class-frequency distribution baked into the dataset
generator). If the simulation's ground truth used the same distribution, the
tree would already be correct and the Bayesian layer would have nothing to
correct. So the simulation deliberately draws ground truth from a DIFFERENT
distribution:
```
P_truth[BATTERY_REPLACE]  = 2.0 × P_train[BATTERY_REPLACE]
P_truth[STARTER_MOTOR]    = 0.5 × P_train[STARTER_MOTOR]
P_truth[ALTERNATOR_ISSUE] = 1.5 × P_train[ALTERNATOR_ISSUE]
```
(then renormalized over all 19 classes). This models real-world distribution
shift between training sample and field population; Bayesian's job is to
close that gap using per-incident feedback. Questionnaire answers per
incident are sampled conditional on the true fault, with 15% per-field noise
(`NOISE_RATE = 0.15`) — i.e., 15% chance any given field gets the "atypical"
alternate answer instead of the "typical" one for that fault class.

Incident arrivals: Poisson process, rate 0.5/min. Locations: uniform over
Colombo metro bounding box (lat 6.85–7.00, lon 79.82–79.92). 40% of
incidents get a synthetic OBD snapshot (`with_obd_frac = 0.4`), correlated
coarsely with the true fault (e.g., BATTERY_REPLACE/TERMINAL_CLEAN →
lower battery_voltage_v; COOLANT_LOW/RADIATOR_*/ENGINE_OVERHEAT_SEVERE →
higher coolant_temp_c).

### 6.2 The 4 strategies compared

| Strategy | Uses tree? | Uses uncertainty (full distribution)? | Learns (Bayesian)? |
|---|---|---|---|
| **UADO** | Yes (Tier 1 or 2) | Yes (ECM over full distribution) | Yes |
| GreedyNearest | No | No — picks nearest available provider regardless of capability | No |
| TypeMatched | Argmax only | No | No |
| MultiCriteria | Argmax only | No — deterministic weighted score: `0.4×(1/(1+travel_min)) + 0.3×trust + 0.3×(1 if capable else 0)` | No |

Resolution-time model (`metrics.py:score_dispatch`): `resolution =
travel_time + service_time(true_type) + (0 if provider_capable else
RE_DISPATCH_PENALTY_MINUTES)`.

### 6.3 Empirical results — CANONICAL, re-verified live 2026-08-15

Command: `python -m sim.simulate --n 1000 --seed 42 --n-providers 20`,
re-run twice consecutively producing byte-identical output (confirms
determinism given fixed seed and current tree artifacts). Matches the values
committed in `sim/outputs/summaries.csv` and `ARCHITECTURE.md` §7.2 exactly.

| Strategy | Match Rate | Provider Capable Rate | Re-dispatch Rate | Avg Resolution (min) | Stdev (min) |
|---|---|---|---|---|---|
| **UADO (full pipeline)** | **39.7%** | **97.6%** | **2.4%** | **65.45** | 46.38 |
| GreedyNearest | 35.5% | 69.7% | 30.3% | 76.98 | 54.88 |
| TypeMatched | 27.3% | 92.2% | 7.8% | 67.43 | 49.62 |
| MultiCriteria | 27.3% | 91.5% | 8.5% | 68.49 | 50.08 |

**Paired t-tests, UADO vs each baseline** (`sim/metrics.py:paired_t_test` —
normal-approximation two-sided p-value, valid at N=1000):

| Comparison | Metric | t-statistic | p-value | Significant (α=0.05)? |
|---|---|---|---|---|
| UADO vs GreedyNearest | resolution time | −19.103 | <0.0001 | Yes |
| UADO vs GreedyNearest | match rate | +2.855 | 0.0043 | Yes |
| UADO vs TypeMatched | resolution time | −6.710 | <0.0001 | Yes |
| UADO vs TypeMatched | match rate | +11.576 | <0.0001 | Yes |
| UADO vs MultiCriteria | resolution time | −9.433 | <0.0001 | Yes |
| UADO vs MultiCriteria | match rate | +11.576 | <0.0001 | Yes |

**Headline numbers for the paper**:
- Match rate: UADO 39.7% vs 35.5% best baseline (+11.8% relative improvement)
- Re-dispatch rate: UADO 2.4% vs 7.8% best baseline (−69% relative reduction)
- Resolution time: UADO 65.45 vs 67.43 min best baseline (−2.9%)
- All differences statistically significant, most at p < 0.0001

**⚠ Reproducibility caveat (disclose in methodology/limitations)**:
During this extraction session, an early ad-hoc run of the identical command
(`--n 1000 --seed 42 --n-providers 20`) produced visibly different numbers
(match rate 51.8% instead of 39.7%) before stabilizing to the values above on
all subsequent reruns. No source file changed between runs.

**Investigated and ruled out**: (1) *String-hash-order randomization* —
tested directly by rerunning with `PYTHONHASHSEED` fixed to 3 different
explicit values (1, 2, 99999) plus 3 more runs at default (randomized)
hash-seed; all 6 produced byte-identical output (39.70%), so hash-seed
variation is not the cause. A real but inconsequential hash-order dependency
does exist — `sim/bayesian.py:blend_prior_with_tree` builds its blended
distribution by iterating `set(tree_probs.keys()) | set(prior_probs.keys())`
(an unordered set) rather than a sorted/list union, and the resulting dict's
insertion order feeds a `sum()` in `normalise()`; floating-point addition
isn't associative, so this can perturb results at the ~1e-15 relative level
— several orders of magnitude below anything visible at reported precision.
Worth a one-line hygiene fix (`sorted(...)` instead of the raw set union) if
the paper wants to claim bit-exact reproducibility as a property, but it is
not what caused the 51.8→39.7 swing. (2) *Stale bytecode cache* —
`sim/__pycache__/*.pyc` timestamps (Aug 11 03:38) are strictly newer than
every `.py` source file (03:24–03:37), so the cache was current, not stale,
during the anomalous run.

**Not yet identified**: the actual root cause of the single 51.8% reading.
14 consecutive reruns since then (across varied hash seeds and repeated
invocations) all agree at 39.70%, matching both the committed
`sim/outputs/summaries.csv` and the independently-authored `ARCHITECTURE.md`
— strong practical evidence the pipeline is deterministic going forward, but
the one outlier is unexplained rather than resolved. **Before citing these
numbers in the paper, do one more clean rerun in the actual submission
environment** as due diligence; if it disagrees, that's a new data point
worth capturing (note the exact environment — OS, Python version, whether
run via `-m sim.simulate` or direct script invocation — since those are the
only remaining unruled-out variables).

**⚠ RESOLVED 2026-08-25**: the mystery is closed, and hash-seed/bytecode
were both red herrings. Ten days after the above was written, `git log`
showed the branch had advanced by 3 commits (`79d5a16`, `2687cd7`,
`5215c2c`) between checks within what felt like one continuous
investigation — the tree JSON files' git status went from "M" (modified,
uncommitted) to clean, their mtimes jumped from Aug 12 to Aug 20, and
`sim/strategies.py` gained a 5th strategy (`ECMOnlyStrategy`) that didn't
exist when this section was first written. **The repo was never
algorithmically nondeterministic — its actual content was changing between
runs because the author (or another session) was committing new work in
parallel.** The current canonical single-seed UADO match rate (re-verified
2026-08-25, post-v3-retrain) is **34.7%** (not 39.7% — that number described
the pre-v3 trees and no longer applies). See §0 and §15 for what changed
and the current numbers. Lesson for future extraction passes: pin a git
commit hash at the start of a session and check for drift before trusting a
"reproducibility anomaly" as a code bug.

### 6.4 Bayesian convergence

Mean posterior entropy across UADO's 1000 incidents shows a two-phase
dynamic: **exploration** (~0–300 incidents) — entropy rises as new symptom
keys are seeded with uniform priors (log₂19 ≈ 4.25 bits each, since Bayesian
only fires on ML-diagnosable classes); **consolidation** (~300+ incidents) —
entropy falls from ~2.5 to ~1.8 bits as posteriors concentrate on their true
classes. Plot: `sim/outputs/convergence.png`. Per-incident entropy trace:
`sim/outputs/dispatch_logs.csv` (4000 rows = 4 strategies × 1000 incidents).

---

## 7. System Implementation Reference

### 7.1 Tech stack (exact versions, `package.json`)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js + TypeScript + Express | express ^4.18.0, typescript ^5.7.3 |
| ORM | Prisma (→ PostgreSQL 16) | @prisma/client ^5.22.0, prisma ^5.22.0 |
| Auth | jsonwebtoken + jwks-rsa (Supabase JWT via JWKS, no shared secret) | ^9.0.3 / ^3.2.2 |
| Validation | Zod | ^4.4.3 |
| Logging | Winston | ^3.19.0 |
| Security middleware | Helmet, CORS | ^8.1.0 / ^2.8.6 |
| Test runner | Vitest + Supertest | ^4.1.9 / ^7.2.2 |
| ML training | scikit-learn + pandas + numpy + matplotlib + seaborn | (see `ml/requirements.txt`) |
| Simulation | Pure Python (no SimPy dependency) | stdlib only + shared ecm/bayesian ports |

Mobile client (outside this component's direct scope but part of the
platform): React Native + Expo, custom dev-client build (BLE support for
OBD-II dongle pairing).

### 7.2 Database schema (PostgreSQL 16 via Prisma, `prisma/schema.prisma`)

6 tables: `incidents`, `providers`, `triage_responses`, `dispatch_decisions`,
`resolution_feedbacks`, `bayesian_priors`.

Key design notes:
- `ServiceType` is a 29-value Postgres enum (19 ML + 10 fast-path).
- Adaptive questionnaire answers are stored as plain `String` columns (NOT
  enums) because they must accept the literal `"NOT_ASKED"` sentinel
  alongside the real enum values — validated at the Zod API boundary instead.
- `BayesianPrior.probabilities` and `TriageResponse.probabilities` are `Json`
  columns holding the full 29-key `{ServiceType: probability}` map.
- `DispatchDecision.costBreakdown` is a `Json` column mirroring the TS
  `CostBreakdown` interface.
- Indexes: `incidents` on `(status)`, `(latitude, longitude)`, `(createdAt)`;
  `providers` on `(type, status)`, `(latitude, longitude)`;
  `resolution_feedbacks` on `(actualServiceType)`, `(wasMatch)`, `(createdAt)`.
- `BayesianPrior.symptomKey` is `@unique` — one row per symptom pattern,
  upserted on every feedback event.

### 7.3 Full API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/triage/questions` | Adaptive form schema with branching rules |
| POST | `/api/v1/triage/submit` | Run triage engine (tree + Bayesian blend), persist, incident → DISPATCHING |
| POST | `/api/v1/dispatch/optimize` | Run ECM optimizer, persist ranked decisions, incident → PROVIDER_ASSIGNED |
| POST | `/api/v1/dispatch/respond` | Provider accept/decline — **not implemented, returns 501** ("Phase 5" placeholder) |
| POST | `/api/v1/incidents` | Create incident |
| GET | `/api/v1/incidents/:id` | Fetch incident |
| GET | `/api/v1/incidents` | List incidents |
| POST | `/api/v1/incidents/:id/resolve` | (incident-level resolve — distinct from feedback endpoint below) |
| POST | `/api/v1/incidents/:incidentId/feedback` | Post-resolution report — closes Bayesian loop, updates provider trust, incident → RESOLVED |
| GET | `/api/v1/bayesian/priors/:symptomKey` | Inspect a stored posterior (research/demo endpoint) |
| GET | `/api/v1/bayesian/stats` | Aggregate learning stats (total priors, avg entropy, most-updated keys) — feeds convergence analysis |
| POST | `/api/v1/bayesian/symptom-key/preview` | Debug: preview what symptom key a given response payload would hash to |
| POST | `/api/v1/providers` | Register provider |
| GET | `/api/v1/providers` | List providers |
| GET | `/api/v1/providers/:id` | Fetch provider |
| PATCH | `/api/v1/providers/:id/status` | Update availability status |
| PATCH | `/api/v1/providers/:id/location` | Update live location |
| GET | `/api/v1/providers/nearby` | Geo-bounded nearby search |

Provider trust score update rule (`feedback.routes.ts`): a dispatch counts as
"successful" if `wasMatch === true` AND (no rating given OR rating ≥ 4).
`trustScore = max(0.5, successfulJobs / totalJobs)` — floored at 0.5 so one
early failure can't tank a new provider's score.

### 7.4 Config constants — single source of truth

From `src/config/index.ts` (env-overridable, defaults shown):

| Constant | Default | Meaning |
|---|---|---|
| `dispatch.trafficLambda` | 0.3 | ECM traffic externality weight (λ) |
| `dispatch.reDispatchPenaltyMinutes` | 45 | Mismatch cost penalty |
| `dispatch.assessmentDelayMinutes` | 10 | Time wasted realizing a mismatch on-scene |
| `dispatch.timeoutSeconds` | 120 | Provider acceptance timeout |
| `bayesian.initialLearningRate` | 0.1 | α_initial |
| `bayesian.minLearningRate` | 0.01 | α_min (floor) |
| `bayesian.windowSize` | 100 | Decay window W |
| (bayesian-engine.ts) `TREE_EFFECTIVE_WEIGHT` | 20 | K in the inference-time blend |
| (bayesian-engine.ts) `MIN_OBSERVATIONS_TO_BLEND` | 3 | Below this, blend suppressed |

### 7.5 Seed data (local dev / demo)

15 providers across Colombo metro (`prisma/seed.ts`): 6 mobile mechanics, 4
light tow trucks, 2 heavy tow trucks, 2 fuel delivery, 1 locksmith.
Capabilities auto-derived from the capability matrix (never hand-duplicated).
Trust scores randomized in [0.65, 0.95] at seed time.

---

## 8. Test Coverage & Reproducibility

**Test suite** (re-run 2026-08-15, `npx vitest run`): **55/56 passing.** The
1 failure is `tests/incidents.route.test.ts > POST /api/v1/incidents >
creates an incident` — expects HTTP 201, got 500. This is an integration
test requiring a live PostgreSQL connection; the failure is environmental
(no DB running in this extraction session), not a code defect. Confirm this
resolves when run against a live `docker-compose` Postgres before citing
"56/56 passing" in the paper — as of right now, verified fact is 55/56 with
1 DB-dependent test unexercised.

Test files: `tests/bayesian-engine.test.ts` (252 lines — includes the
convergence proofs described in §4.3), `tests/dispatch-optimize.geo.test.ts`
(184 lines — ECM integration with geo-intelligence), `tests/geo-client.test.ts`
(186 lines — mocked HTTP client), `tests/symptom-key.test.ts` (85 lines — hash
stability), `tests/incidents.route.test.ts` (21 lines — HTTP smoke, DB-dependent).

**Reproducibility steps** (from `ARCHITECTURE.md §8`, cross-checked against
actual scripts):
```powershell
# Backend
cd components/dispatch
npm install && npm run prisma:generate
docker compose -f ../../docker-compose.yml up -d postgres redis
npm run prisma:migrate deploy && npm run prisma:seed
npm test

# ML training (deterministic, seed=42)
cd ml && python train_real.py

# Simulation (deterministic, seed=42 — see §6.3 caveat)
cd ../sim && python -m sim.simulate --n 1000 --seed 42 --n-providers 20
```

---

## 9. Known Limitations (verified against current code, not stale)

1. **Class taxonomy scope** — 19 diagnosable + 10 fast-path types; 2 classes
   present in real data (`HYDRO_LOCK`, `ABS_SENSOR_RUST_CORROSION`, 9 rows)
   are dropped, not modelled. Extending requires a Prisma migration + updated
   capability matrix.
2. **Class imbalance** — real questionnaire data is imbalanced (e.g.
   BATTERY_JUMP is the majority class; SEVERE_MECHANICAL_TOW is a minority
   class, ~10 rows) — depresses accuracy on rare classes. No SMOTE or
   class-weighting currently applied (unlike the procrastination-detection
   reference paper's approach) — a candidate future-work item if the paper
   benchmarks against that kind of remediation.
3. **Tier 2 join method** — real questionnaire rows and real OBD rows come
   from DIFFERENT incidents; Tier 2 training pairs them synthetically by
   matching `service_type` (with replacement). Not a true joint observation.
   Disclose this plainly — it is the single biggest "how real is Tier 2
   really" caveat.
4. **Bayesian activation threshold** — posterior only influences dispatch
   after ≥3 observations per symptom key (`MIN_OBSERVATIONS_TO_BLEND`). Rare
   patterns may never activate under low feedback velocity in production.
5. **Simulated traffic score** — `sim/simulate.py` currently defaults to a
   flat traffic score in the simulation loop rather than sampling
   stochastically; live production reads Geo-Intelligence in real time. A
   stochastic-traffic scenario is scoped as easy future work.
6. **No real-vehicle field validation** — tree accuracy is measured on
   held-out questionnaire rows, not on live diagnostics against actual
   vehicles. No domain-expert sign-off/agreement-rate study currently exists
   (contrast with the coral-reef reference paper's 80% expert-agreement
   validation, or the procrastination paper's live pilot deployment) — this
   is the most significant methodological gap relative to comparable
   published work and should be either addressed (a small field study with
   mechanics/dispatchers reviewing a sample of ECM decisions) or explicitly
   scoped as future work in the Limitations section.
7. **ECM trust-term inconsistency between production and simulation** —
   see §4.2 note: TS divides cost by trust, Python simulation adds a trust
   penalty term. Both are directionally correct but not numerically
   identical; if the paper claims the simulation validates the exact
   production algorithm, this should be reconciled or explicitly caveated.
8. **`POST /dispatch/respond` unimplemented** (returns 501) — provider
   accept/decline handling is a known placeholder, not yet built.
9. **No real-data Random Forest comparison** — the RF-vs-DT interpretability
   trade-off story (§5.3) is currently only demonstrated on the synthetic
   baseline dataset, not on the real 434-row dataset now in production.

---

## 10. Existing Citation Anchors (from `ARCHITECTURE.md §11` — verify/expand before use)

- Bayesian formulation: Robbins & Monro (1951), stochastic approximation
  theory, applied to a Dirichlet-Multinomial posterior mean.
- ECM formulation: extends classical MADM (Multi-Attribute Decision Making)
  dispatch approaches; cf. Bertsimas & Tsitsiklis, *Introduction to Linear
  Optimization*, ch. 12 (stochastic programming) — integrating over a
  probability distribution rather than a point estimate.
- Domain knowledge base (`automotive_faults.json`): derived from Bosch
  Automotive Handbook (10th ed.) diagnosis chapters + Toyota technical
  service bulletins (public repair manuals).
- `fault_flowchart.json`: expert-derived from consultation with two
  practising Sri Lankan mechanics (interview notes referenced as "project
  appendix" — locate and cite properly, not yet a formal citation).
- `NEV_fault_dataset.csv`: public Kaggle EV motor telemetry (2023),
  reference only.

**Note for the paper-writing agent**: none of the above are yet in proper
academic citation format (author/year/venue) — they need to be resolved to
real bibliographic entries before submission. This list is a pointer to
what needs citing, not citation-ready text.

---

## 11. Repository Map (for diagram generation / code cross-referencing)

```
components/dispatch/
├── ARCHITECTURE.md              ← companion engineering doc (source-cross-checked into this file)
├── prisma/schema.prisma         ← DB schema, 6 tables, described in §7.2
├── prisma/seed.ts               ← 15 seed providers, §7.5
├── src/
│   ├── index.ts                 ← Express entry, middleware stack
│   ├── config/index.ts          ← all tunable constants, §7.4
│   ├── constants/capability-matrix.ts  ← provider↔service capability lookup, §5.5
│   ├── contracts/geo-service-mapping.ts ← service-type → geo-intel incident-type mapping
│   ├── middleware/auth.ts       ← Supabase JWT/JWKS verification
│   ├── routes/{incident,triage,dispatch,provider,feedback}.routes.ts  ← §7.3
│   ├── services/triage-engine.ts        ← SO1 orchestrator, §4.1
│   ├── services/decision-tree-engine.ts ← JSON tree walker, §4.1
│   ├── services/bayesian-engine.ts      ← SO3 pure math, §4.3
│   ├── services/bayesian-service.ts     ← SO3 DB wrapper, §4.3
│   ├── services/dispatch-optimizer.ts   ← SO2 ECM, §4.2
│   ├── services/geo-client.ts           ← Geo-Intelligence HTTP client, §3.1
│   ├── types/index.ts           ← full type catalog, §5.5 + §4.1.1
│   └── utils/symptom-key.ts     ← SO3 SHA-1 hashing, §4.3
├── tests/                       ← §8, 5 files, 56 tests (55 passing without live DB)
├── ml/
│   ├── new_datasets/            ← real training data, §5.1
│   ├── generate_dataset.py      ← original synthetic generator (baseline retained)
│   ├── train_compare.py         ← DT-vs-RF comparison, synthetic data, §5.4(B)
│   ├── train_real.py            ← REAL-DATA retraining pipeline, §5.2
│   ├── exported_tree_tier{1,2}.json            ← current production trees
│   ├── exported_tree_tier{1,2}_synthetic.json  ← archived baseline
│   └── reports/{tier1,tier2,real_data_metrics.json,real_confusion_tier{1,2}.png}
└── sim/
    ├── simulate.py              ← main harness, §6
    ├── strategies.py            ← UADO + 3 baselines, §6.2
    ├── scenario.py              ← incident generator w/ ground truth + truth-drift, §6.1
    ├── ecm.py                   ← ECM cost function Python port, §4.2
    ├── bayesian.py              ← Bayesian update Python port, §4.3
    ├── tree_walker.py           ← JSON tree evaluator (Python side)
    ├── metrics.py                ← aggregation + paired t-tests, §6.3
    ├── plots.py                  ← matplotlib figures
    └── outputs/{dispatch_logs.csv, summaries.csv, convergence.png, comparison.png}
```

---

## 12. Suggested Diagrams for the Paper (source data already in this document)

1. **Three-stage pipeline diagram** — §3 flow: Triage Tree → ECM Optimizer →
   Bayesian Feedback Loop, with fast-path bypass shown as a side branch.
2. **Deployment/microservices diagram** — §3.1, 4 backend services + mobile
   app, showing the dispatch↔geo-intelligence HTTP dependency with its
   graceful-degradation fallback.
3. **Adaptive questionnaire decision tree** — §4.1.1, Q1 → branching
   single-selects → always-asked tail. Good candidate for a flowchart figure.
4. **Bayesian feedback sequence diagram** — §3.3, already in swimlane form,
   ready to redraw as a proper UML sequence diagram.
5. **ECM cost formula box diagram** — §4.2, showing the three cost
   components (service, mismatch, traffic externality) feeding into total
   cost, with the trust divisor/adjustment.
6. **Simulation results bar chart** — §6.3 table, UADO vs 3 baselines across
   4 metrics (match rate, capable rate, re-dispatch rate, resolution time) —
   raw data already exists as `sim/outputs/comparison.png`, can be
   regenerated/restyled.
7. **Bayesian convergence line chart** — §6.4, entropy vs incident index,
   raw data in `sim/outputs/convergence.png` / `dispatch_logs.csv`.
8. **Real vs synthetic data pipeline comparison** — §5.4, a before/after
   diagram showing the same architecture consuming two different data
   sources with the resulting accuracy table.

---

## 13. Probability Calibration Evaluation (Brier / Log-Loss / ECE) — NEW, 2026-08-25

**Source**: `ml/calibration_eval_v3.py` (new script, added for this analysis).
Reuses `ml/train_v3.py`'s exact real-only-holdout split and DecisionTree
training config (seed=42) so these numbers describe the SAME model and SAME
87-row real-only holdout set as the currently-deployed
`exported_tree_tier{1,2}.json`. **Correctness cross-check**: recomputed
log-loss matches `train_v3.py`'s own independently-computed log-loss to 6
decimal places for both tiers — confirms the split/model was reconstructed
exactly, not approximately.

**Metrics used** (formulas, so the paper can state them precisely):
- **Multiclass Brier score** = `mean_i [ Σ_k (P_ik − y_ik)² ]` — predicted
  probability vector vs one-hot ground truth, summed over the 19 classes,
  averaged over the 87 test samples. Standard multiclass generalization of
  the binary Brier score. 0 = perfect, higher = worse (theoretical max = 2
  for a maximally wrong confident prediction).
- **Log-loss**: `sklearn.metrics.log_loss(y_true, P, labels=all_19_classes)`.
- **ECE (Expected Calibration Error)**: 10 equal-width bins on confidence
  (`max` predicted probability per sample); `ECE = Σ_b (n_b/N)·|acc_b − conf_b|`.

| Model (v3, real-only holdout, N=87) | Accuracy | Brier (multiclass) | Log-loss | ECE (10-bin) |
|---|---|---|---|---|
| Tier 1 (questionnaire only) | 64.4% | **0.7184** | 12.851 | **0.362** |
| Tier 2 (questionnaire + OBD) | 69.0% | **0.6207** | 11.186 | **0.310** |

Reliability diagrams (predicted confidence vs empirical accuracy, plus a
confidence histogram): `ml/reports/reliability_v3_tier{1,2}.png`. Full
per-bin breakdown: `ml/reports/calibration_metrics_v3.json`.

**Interpretation — important for the paper's narrative, not just a numbers
dump**: ECE of 0.31–0.36 is high in absolute terms — the model's stated
confidence is a poor guide to its actual correctness rate. This is the
expected signature of an **unregularized decision tree with
`min_samples_leaf=1`**: many leaves are reached by only 1–2 training
samples and therefore output 100%-confident predictions (a pure leaf),
regardless of how well that leaf actually generalizes. This is a textbook
decision-tree calibration failure mode, not specific to this dataset.
**This finding directly motivates and strengthens the paper's existing
Bayesian-layer design (§4.3)**: the Dirichlet-multinomial posterior update
is not just a "self-calibration from field feedback" feature in the
abstract — it is the mechanism that corrects exactly this kind of
raw-tree overconfidence, by pulling predictions toward empirically-observed
frequencies instead of trusting a single pure leaf. Recommend using this
calibration result in the Methodology section as the explicit motivation
for why Bayesian blending matters, not just in the Results section as a
number.

**Caveat**: no calibrated baseline (e.g., Platt scaling, isotonic
regression) was evaluated for comparison. If the paper wants to claim
Bayesian blending is the *right* calibration fix rather than *a* fix, an
isotonic/Platt baseline on the same holdout would be the natural ablation to
add — not done here, flagged as a possible future-work item rather than
computed.

---

## 14. ECM Ablation — Full-Distribution vs Argmax/One-Hot ECM — NEW, 2026-08-25

**Source**: `sim/ablation_ecm.py` (new script, added for this analysis).

**What this isolates**: whether the ECM cost function's design choice to
integrate over the FULL triage probability distribution (production UADO)
— rather than collapsing to a one-hot on the argmax before costing, as most
published point-estimate dispatch systems do — actually matters empirically.

**This is a different ablation from the existing `ECMOnlyStrategy`**
(`sim/strategies.py`, already in the repo, results in
`sim/outputs/multi_seed_report.json`) — that one ablates the *Bayesian
feedback loop* (tree+ECM vs tree+Bayesian+ECM). This new one ablates the
*ECM input distribution itself*, holding the Bayesian blend identical in
both arms: `ArgmaxECMStrategy` subclasses `UADOStrategy`, runs the identical
tree inference and identical Bayesian blend, then collapses the blended
distribution to `one_hot(argmax)` immediately before calling the same
`rank_providers()` cost function UADO uses. Everything else — incident
stream, provider pool, capability matrix, cost formula itself — is held
fixed via the same paired-seed design as the rest of the simulation.

**Protocol**: reused the existing 30-seed / paired-t / McNemar statistical
machinery from `sim/simulate.py` (same functions, not a weaker
single-seed comparison) — seeds 42–71, 1000 incidents/seed, 20 providers,
30,000 paired dispatches per strategy. Verified deterministic (matches the
30-seed protocol style already validated for `ECMOnly` in
`multi_seed_report.json`).

| Strategy | Match% (mean±SD) | Capable% (mean±SD) | Re-dispatch% (mean±SD) | Avg. Resolution min (mean±SD) |
|---|---|---|---|---|
| **UADO (full-distribution ECM)** | 34.41 ± 2.22 | **97.07 ± 1.71** | **2.93 ± 1.71** | **66.54 ± 2.04** |
| **ArgmaxECM (one-hot ECM)** | 34.41 ± 2.22 | 94.87 ± 1.62 | 5.13 ± 1.62 | 67.30 ± 2.07 |

**Pooled significance (30,000 paired incidents)**:
- Resolution time: paired-t **t = −21.353, p < 0.0001** (significant)
- Match rate: McNemar b=0, c=0 → **not significant / undefined** — see
  interpretation below, this is expected, not a null result to worry about.
- Provider-capable rate: McNemar **χ² = 640.53, p < 0.0001** (significant)

**Interpretation — read this before writing it up, the match-rate result
needs correct framing**: match rate is *identical by construction* between
the two arms (McNemar b=c=0 means the two strategies never disagreed on a
single incident's predicted class) — both `UADOStrategy` and
`ArgmaxECMStrategy` report `argmax(blended_distribution)` as their
prediction; the ablation only changes what gets handed to the COST
function, not what gets diagnosed. **The correct claim for the paper is not
"full-distribution ECM improves diagnostic accuracy"** (it doesn't, by
construction, and shouldn't be expected to) — **the correct claim is "given
the identical diagnosis, integrating the full distribution into the cost
function instead of committing to the argmax measurably improves which
provider gets dispatched."** Concretely: +2.2 percentage points
provider-capable rate (97.1% vs 94.9%), −43% relative reduction in
re-dispatch rate (2.93% vs 5.13%), and a statistically significant ~46-second
reduction in average resolution time (66.54 vs 67.30 min) — all from
hedging against the tree's residual uncertainty in the cost function even
when the point prediction is unchanged. This is the correct way to state
the value of SO2's "expected cost under uncertainty" design choice as
distinct from SO1's diagnostic accuracy.

Raw outputs: `sim/outputs/ablation_ecm_multi_seed_report.json`.

---

*This document was compiled by direct source inspection and live pipeline
re-execution, primarily on 2026-08-15 with a follow-up pass on 2026-08-25
(§0, §13, §14, and the §6.3 closing note). Where it states a number as
"confirmed live" or "canonical," that means the number was reproduced by
actually running the code, not copied from a comment or a prior doc. See §0
for what is now stale and should be re-verified before the paper is
finalized — the Bayesian engine formula (§4.3) and ML accuracy table (§5.4)
in particular describe an earlier version of the code than what is
currently deployed.*
