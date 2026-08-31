# UADO — Uncertainty-Aware Dispatch Optimization

**Component of Kaduna.lk — R26-SE-026 (SLIIT Software Engineering, 2026)**
**Author**: Janukshan Sivakumar (IT22635266)

**This is the v3 target-state architecture** (2026-08-19). It reflects
where the system should be after implementing the changes below — your
current running system still matches the original v1 document. Section
0 summarizes exactly what changed and why, then the rest of the
document reads as a normal architecture spec for the target state. A
companion `IMPLEMENTATION_GUIDE.md` gives the step-by-step build order.

---

## 0. Changelog from v1 — what changed and why

| Area | v1 (current running system) | v3 (target, this document) | Why |
|---|---|---|---|
| Bayesian feedback | EMA update, falsely claimed Robbins-Monro convergence | Discounted Dirichlet-multinomial update | The RM claim was checked and found mathematically false (learning rate floors instead of decaying to zero). New formulation is validated (§ 7.3) and theoretically correct. |
| Questionnaire schema | 20 fields incl. `location_name`, `vehicle_model` | 18 fields — both dropped | Cardinality audit: `location_name` (20 unique/443 rows, no dominant value) and `vehicle_model` (26 unique, top value only 5.2%) are too sparse to learn from reliably and dilute the tree. |
| Dataset scale | 443 questionnaire / 285 OBD, real only | 989 questionnaire / 950 OBD (real + expert-reviewed synthetic) | Addresses dataset-scale and class-imbalance limitations. |
| OBD features | 15 numeric PIDs only | 15 PIDs + `detected_dtc` (expert-informed) | DTCs are closer to root cause than raw sensor snapshots; expert-curated mapping now covers 14/21 classes. |
| Class coverage | 19 classes (2 dropped: `HYDRO_LOCK`, `ABS_SENSOR_RUST_CORROSION`) | Still 19 ML-trained classes; the 2 dropped classes are scaled to 16/20 rows in Tier 1 but remain below the retrain threshold | Honest limitation, not silently resolved — see § 9. |

**What is genuinely real vs. expert-informed-synthetic in this
version — be precise about this in the paper**:

- The 443 questionnaire rows and 285 OBD PID readings are **real,
  unchanged** (only 2 columns dropped from the questionnaire).
- The ~546 additional questionnaire rows and ~665 additional OBD rows
  are **synthetic**, built by two different validated methods (§ 4.4):
  template-based (questionnaire) and distribution-fit (OBD) — both
  empirically shown to preserve real signal faithfully, neither
  fabricating new information.
- The `detected_dtc` field is **expert-informed, not device-captured**
  for every row, real or synthetic — no vehicle in this dataset had a
  DTC actually read from a dongle. It is assigned from a real,
  expert-curated 183-row DTC→class reference table (§ 4.5), which is
  itself a genuine artifact (a technician's domain knowledge,
  systematically catalogued) even though it does not constitute
  per-incident device observations.
- **Recommended paper limitation language** (you asked for this
  explicitly): *"Given practical constraints on the volume of data
  obtainable directly from field experts, the training set was scaled
  using a combination of real field/expert-validated data, a
  distribution-preserving resampling method validated against the real
  data's own signal characteristics, and an expert-curated DTC
  reference mapping, rather than relying solely on manual expert data
  entry. This is disclosed as a methodological choice, not presented
  as equivalent to an equivalently-sized purely real dataset."*

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

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  1. Diagnostic    │    │  2. ECM           │    │  3. Bayesian      │
│     Triage Tree   │───▶│     Optimizer     │───▶│     Feedback Loop │
│  (Tier 1 or 2)    │    │  (Cost function)  │    │  (Dirichlet prior) │
└───────────────────┘    └───────────────────┘    └───────────────────┘
        │                        │                        │
   probability                provider                posterior
   distribution                ranking                  update
   over 19 fault             (argmin cost)         (feeds next dispatch)
   classes
```

Fast-path emergencies (MAJOR_CRASH, FUEL_LEAK, LOCKOUT, ...) short-circuit
the ML tier entirely and route to a hard-coded specialist type.

---

## 2. Research Objectives

| SO | Description | Status |
|---|---|---|
| **SO1** | Adaptive symptom questionnaire + ML-derived decision tree | ✅ Complete (schema simplified, § 0) |
| **SO2** | ECM-based dispatch optimizer with mismatch penalty and traffic impact | ✅ Complete |
| **SO3** | Bayesian posterior update from post-resolution feedback | 🔧 **Rebuild required** — see § 5.3 |
| **SO4** | OBD-II integration for Tier-2 (sensor-augmented) diagnosis | 🔧 **Extend** — add `detected_dtc` field, § 4.5 |
| **SO5** | Discrete-event simulation validating UADO against 3 baselines with statistical significance | 🔧 **Extend** — add ECM-only ablation arm, 30-seed protocol, McNemar's test |

---

## 3. System Architecture

*(unchanged from v1 — deployment topology, dispatch service internals,
and the Bayesian feedback sequence diagram all still apply structurally;
only the math inside the Bayesian step changes, § 5.3)*

---

## 4. Data Pipeline & Lineage

### 4.1 Datasets

| File | Provenance | Rows | Role |
|---|---|---|---|
| `questionnaire_final_v3.csv` | 443 real (2 cols dropped) + synthetic template-based rows | 989 | Tier 1 training |
| `obd_final_v3.csv` | 285 real (with expert-informed `detected_dtc` retrofit) + synthetic distribution-fit rows | 950 | Tier 2 training |
| `dtc_expert_mapping_full.csv` | Real, expert-curated DTC→class reference (technician-authored) | 183 rows, 14/21 classes | Grounds the `detected_dtc` field; not itself training data |

### 4.2 Schema changes

**Dropped**: `location_name`, `vehicle_model` (cardinality audit —
see § 0 changelog table for exact numbers). `vehicle_make` retained
(9 categories, well-populated).

**Added** (Tier 2 only): `detected_dtc` — categorical, values are
either a real DTC code (e.g. `P0562`) or `NOT_APPLICABLE` for the
6 classes with no expert-mapped DTC (`BELT_BROKEN`, `BRAKE_FAILURE`,
`BRAKE_PAD_WORN`, `ELECTRICAL_FAULT_RAIN`, `RADIATOR_HOSE_LEAK`,
`SEVERE_MECHANICAL_TOW`).

### 4.3 Preprocessing pipeline (updated)

```
1. LOAD
   ├─ questionnaire_final_v3.csv   (989 rows: real + template-synthetic)
   ├─ obd_final_v3.csv              (950 rows: real + distribution-synthetic)
   └─ Filter to expert_status ∈ {VERIFIED, VERIFIED_PIDS_ONLY, APPROVED}
      -- do NOT train on rows still marked PENDING

2. NORMALIZE
   ├─ Missing/blank single-selects → "NOT_ASKED"
   ├─ Multi-select fields → JSON arrays → indicator columns
   └─ (location_name, vehicle_age_bucket logic REMOVED -- fields dropped)

3. JOIN (Tier 2 only)
   Same service_type-based join as v1 (§ 9 limitation still applies,
   partially mitigated -- see § 9)

4. FEATURE ENCODING
   ├─ Categorical singles → one-hot
   ├─ Multi-selects → indicator columns
   ├─ OBD numerics → float
   └─ detected_dtc → one-hot (new)

5. STRATIFIED 80/20 SPLIT, seed=42 (or 30-seed protocol, § 7.2.1)

6. TRAIN
   DecisionTreeClassifier(random_state=42, min_samples_leaf=1, criterion="gini")
   + RandomForestClassifier(n_estimators=200, min_samples_leaf=1, random_state=42) as comparison

7. EVALUATE — holdout acc, top-3, macro F1, 5-fold CV. Report per-tier,
   with and without `detected_dtc`, to isolate its real contribution.

8. EXPORT → exported_tree_tier{1,2}.json
```

---

## 5. Algorithms

### 5.1 Diagnostic Decision Tree (SO1)

Unchanged in structure from v1 (nested JSON tree, leaf = probability
distribution). Feature set changes per § 4.2.

### 5.2 Expected Cost Minimization Optimizer (SO2)

```
Cost(p) = Σ_s P(s) · [ travel_time(p) + service_time(s) + mismatch_penalty(p, s) ]
        + λ · TrafficImpact
        + (1 − TrustScore(p)) · TRUST_PENALTY
```

- `mismatch_penalty(p, s) = 45 min` if *p* cannot handle *s*, else 0
- `TRUST_PENALTY = 15 min`
- `λ = 0.3 min/unit` — carries implicit units of minutes per
  traffic-impact-unit, so `λ · TrafficImpact` is dimensionally
  consistent with the minutes-denominated terms it's added to.

Unchanged from v1 otherwise. Sensitivity analysis over λ and the
mismatch penalty is still outstanding (§ 9).

### 5.3 Bayesian Feedback Layer (SO3) — REBUILD REQUIRED

**This is the highest-priority code change.** The v1 EMA formulation's
"Robbins-Monro convergence" claim was checked and found false (the
learning rate floors at `α_min` rather than decaying to zero, so
`Σα²` diverges). Replace entirely with:

**Symptom key** (unchanged):
```
KEY = SHA1( Q1_intent | Q2_engine_start | Q3_sound |
            Q_brake_detail | Q7_overheat_detail )[:16]
```

**Posterior update (NEW)** — maintain a Dirichlet pseudo-count vector
`α_x = (α_x,1, ..., α_x,19)` per symptom key, initialized to
`α_x,k^(0) = α_0 = 0.5` for all k. On each resolution outcome `k*`:

```
α_x,k ← γ · α_x,k + 𝟙[k = k*]          for all k, γ = 0.99
P_prior(k | x) = α_x,k / Σ_j α_x,j
```

This is standard Dirichlet-multinomial conjugacy with exponential
discounting (West & Harrison, *Bayesian Forecasting and Dynamic
Models*, 2nd ed., 1997) — not an ad-hoc EMA. At `γ=1`, posterior
consistency follows directly from conjugacy (no Robbins-Monro
machinery needed). At `γ=0.99` (`ESS ≈ 100`), it adapts to drift —
validated empirically, § 7.3.

**Inference-time blend** (form unchanged):
```
P_final = (K · P_tree + n_x · P_prior) / (K + n_x)
```
`K = 20`; `n_x` = real observation count for symptom key `x`, tracked
independently of the discounted `α_x` mass; blend suppressed below
`n_x < 3`.

**Reference implementation**: `ml/bayesian_reference/dirichlet_bayesian.py`
(validated, § 7.3 — port this logic into `services/bayesian-engine.ts`).

**Implementation checklist**:
- [ ] Replace EMA update function with the count-based update above
- [ ] Replace linear-decay `α(n)` schedule with fixed `γ = 0.99`
- [ ] Store `α_x` (19-dim vector) per symptom key, not a single blended probability
- [ ] Track `n_x` as a separate real-observation counter
- [ ] Port and re-run `tests/bayesian-engine.test.ts` against the new rule
- [ ] Re-run § 7.2 simulation (dispatch decisions depend on `P_final`)

---

## 6. Implementation Stack

*(unchanged from v1)*

---

## 7. Empirical Results

### 7.1 Diagnostic tree accuracy — PENDING RE-RUN on v3 dataset

v1's 3-way ablation numbers (47.1% Tier 1, 54.0% Tier 2, 31.0%
OBD-only) were measured on the original 434/285-row real-only dataset
and **do not reflect the v3 scaled dataset or the new `detected_dtc`
feature**. Re-run required:

1. Train on `questionnaire_final_v3.csv` / `obd_final_v3.csv`
   (VERIFIED + APPROVED rows only).
2. Report Tier 1, Tier 2 **with** `detected_dtc`, Tier 2 **without**
   `detected_dtc` (three-way, to isolate the DTC feature's real
   contribution — do not assume it helps; measure it).
3. Use the same held-out real-data test methodology as v1 (or the
   30-seed protocol, § 7.2.1, if time allows) — **critical**: if any
   synthetic rows exist in your test set, the accuracy numbers are not
   trustworthy. Hold out real rows only, exactly as in the augmentation
   validation done during dataset construction.

### 7.2 SimPy validation — PENDING RE-RUN

v1 numbers (39.7% match rate, 2.4% re-dispatch, etc.) used the old
Bayesian formulation and a single seed. Re-run with:

1. New Dirichlet-multinomial Bayesian layer (§ 5.3) implemented
2. 4 arms: GreedyNearest, TypeMatched, MultiCriteria, **+ECM-only
   ablation** (ECM cost function without Bayesian blending)
3. 30 seeds, report mean ± SD, 95% CI
4. McNemar's test for match-rate (binary outcome), paired t-test
   retained for resolution-time only

### 7.3 Bayesian convergence — VALIDATED (reference implementation)

Standalone Python validation of the § 5.3 update rule
(`ml/bayesian_reference/dirichlet_bayesian.py`), safe to cite —
this is a mathematical property test, not dependent on real-world
class separability:

- **Clean convergence**: 95.7% posterior mass on true class after 200
  observations (`γ=1`, exceeds old EMA's >85% claim)
- **Noise robustness**: correct `argmax` maintained under 30% label noise
- **Drift adaptivity**: at `γ=0.99`, posterior favours the new true
  class 78.6% by 150 observations post-drift, vs. 32.8% for a
  non-discounting (`γ=1`) control under the same drift — demonstrates
  *why* discounting matters, not just that the math is valid

**Still pending**: port into TypeScript, confirm the port reproduces
these exact numbers, re-run the § 7.2 entropy-trajectory measurement
end-to-end in production code.

### 7.4 Data augmentation & model-selection — VALIDATED (do not repeat blindly)

From the v1→v2 investigation (still valid, methodology unaffected by
the v3 dataset changes):

- Resampling-based augmentation alone does **not** reliably improve
  accuracy (30-seed test, deltas within noise, −0.020 to +0.011)
- Switching Decision Tree → Random Forest gives a real, robust
  **+7.8pp** improvement, independent of augmentation
- **Do not re-test the `detected_dtc` feature via simulation** — an
  early attempt produced a misleading 100% accuracy from label leakage
  (the feature was assigned deterministically from the label). The
  only trustworthy measurement is your real retrain on § 7.1's protocol.

---

## 8. Reproducibility

*(same structure as v1; update `train_real.py` invocation to point at
`questionnaire_final_v3.csv` / `obd_final_v3.csv`)*

---

## 9. Limitations & Future Work

**Class taxonomy scope**. `HYDRO_LOCK` (16 rows after scaling) and
`ABS_SENSOR_RUST_CORROSION` (20 rows after scaling) remain below the
50-row target and have zero real OBD anchor. Not reinstated in this
version — would need genuine new real cases, not further scaling.

**Class balance**. Addressed via § 4.4 scaling (real-distribution-fit
and template-based methods, both empirically validated to preserve
real signal). Per § 7.4, this does not by itself improve holdout
accuracy for the current tree — value is coverage/imbalance hygiene,
confirm empirically per-model in § 7.1's re-run.

**Tier 2 join method**. Still synthetic pairing by `service_type`
(unchanged limitation from v1) — not resolved by this version.

**`detected_dtc` provenance**. Expert-informed, not device-captured,
for every row (§ 0). Disclose exactly this in the paper — do not
describe it as measured field data. The only way to obtain a
trustworthy accuracy contribution number for this feature is a real
retrain-and-holdout-evaluate cycle (§ 7.1), not simulation.

**Bayesian methodology**. Corrected and validated at the reference-
implementation level (§ 7.3); production TypeScript port still
outstanding.

**No parameter sensitivity analysis**. `λ` and the 45-minute mismatch
penalty remain fixed by design judgment.

**ECM production/simulation formula divergence**. Unchanged from v1 —
not addressed in this version.

---

## 10. Repository Layout & 11. Citations

*(unchanged from v1, plus: add citation for the technician-authored DTC
mapping as an internal expert-knowledge artifact, and West & Harrison
1997 replacing Robbins & Monro 1951 per § 5.3)*
