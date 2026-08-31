# UADO v3 Implementation & Testing Guide

Practical, ordered steps to go from your current running system (v1) to
the target state (`ARCHITECTURE.md` v3) and produce the numbers needed
to finish the paper. Each step says what to run, what "done" looks
like, and exactly what to report back.

---

## Step 0 — Files you now have

| File | What it is |
|---|---|
| `questionnaire_final_v3.csv` | 989 rows (443 real + synthetic), 2 columns dropped |
| `obd_final_v3.csv` | 950 rows (285 real + synthetic), includes new `detected_dtc` field |
| `questionnaire_final_v3_summary.csv` / `obd_final_v3_summary.csv` | Per-class real/synthetic/final counts |
| `dtc_expert_mapping_full.csv` | The 183-row expert DTC→class reference (not training data itself) |
| `ARCHITECTURE.md` | Target-state spec |

**Before anything else**: send `questionnaire_final_v3.csv` and
`obd_final_v3.csv` to Volvo Malabe / AutoMe for review. Every synthetic
row has `expert_status = PENDING`. Change it to `APPROVED` or
`REJECTED` per row (or in bulk if they're comfortable with the
method after spot-checking a sample — your call on how rigorous this
needs to be given your timeline).

---

## Step 1 — Implement the Bayesian fix (do this first, it blocks Step 4)

1. Open `ml/bayesian_reference/dirichlet_bayesian.py` (provided) — read
   it, it's ~80 lines and directly portable.
2. In `services/bayesian-engine.ts` (or wherever your EMA update
   currently lives), replace:
   - The `α(n)` linear-decay schedule → fixed `γ = 0.99`
   - The single blended-probability storage per symptom key → a
     19-dimensional Dirichlet count vector `α_x`, initialized to `0.5`
     per class
   - The update rule `P_new = (1-α)P_old + α·onehot(actual)` →
     `α_x,k ← γ·α_x,k + 𝟙[k=k*]` for all k, then `P_prior = α_x / Σα_x`
3. Keep the inference-time blend formula's *shape* the same — just
   feed it `P_prior` from the new Dirichlet math instead of the old
   EMA scalar. Track `n_x` (real observation count) as a simple
   separate counter, independent of `α_x`.
4. **Test**: port the three tests from `dirichlet_bayesian.py` into
   `tests/bayesian-engine.test.ts`:
   - 200 clean observations → posterior mass on true class should
     exceed ~95% (not just the old 85% target)
   - 30% noisy observations → `argmax` should still converge
   - Drift test (optional but valuable): true class switches after
     300 observations → posterior should favor the new class within
     ~150 observations
5. **Report back**: pass/fail on each test, and the actual percentages
   (should be close to 95.7% / converges / 78.6%, matching the Python
   reference — if noticeably different, something in the port differs
   from the reference implementation and is worth flagging before
   moving on).

---

## Step 2 — Retrain the diagnostic tree on the v3 dataset

1. Point `train_real.py` at `questionnaire_final_v3.csv` and
   `obd_final_v3.csv`.
2. **Filter first**: only train on rows where
   `expert_status ∈ {VERIFIED, VERIFIED_PIDS_ONLY, APPROVED}` — exclude
   anything still `PENDING` or marked `REJECTED`.
3. Run **four** training configurations, not one:
   - Tier 1 (questionnaire only, new schema without `location_name`/`vehicle_model`)
   - Tier 2 without `detected_dtc` (the 15 PIDs only, as in v1)
   - Tier 2 with `detected_dtc` added as a feature
   - Same three, but with `RandomForestClassifier(n_estimators=200, min_samples_leaf=1, random_state=42)` instead of the tree
4. **Held-out test set must be 100% real rows**, never synthetic. If
   your existing train/test split logic doesn't already guarantee this
   for the v3 files, fix that before trusting any number — this is the
   single most important methodological rule from everything we've
   done. (Concretely: filter to `source == 'real'` or
   `source == 'real_dtc_expert_retrofit'` *before* splitting, take your
   test fold from that real-only pool, then augment only the training
   fold.)
5. **Report back**: holdout accuracy / top-3 / macro-F1 / 5-fold CV for
   all eight combinations (2 tiers × 2 DTC conditions × 2 models). This
   directly tells us whether `detected_dtc` and/or Random Forest are
   worth adopting — don't assume either; the numbers decide.

---

## Step 3 — Re-run the dispatch simulation

1. Add a 4th strategy arm to `sim/strategies.py`: **ECM-only** — same
   cost function as full UADO, but skip the Dirichlet blend step
   (`P_final = P_tree` always).
2. Run **30 seeds**, not 1 (loop `--seed 0` through `--seed 29`,
   re-sampling the incident stream each time).
3. For match rate (binary per-incident outcome), compute McNemar's
   test between UADO and each baseline instead of a paired t-test:
   `χ² = (|b−c|−1)² / (b+c)` using discordant pair counts. Keep the
   paired t-test for resolution time (continuous).
4. **Report back**: the 4-strategy × 30-seed table (mean ± SD for
   match rate, capable rate, re-dispatch rate, resolution time),
   McNemar's χ²/p for match rate, paired t-test for resolution time.

---

## Step 4 — Bayesian convergence, in production code

Only after Step 1 is deployed: re-run the entropy-trajectory
measurement from the Step 3 simulation (production Dirichlet code, not
the standalone reference) and confirm it qualitatively matches §7.3's
validated reference numbers (exploration phase, then consolidation,
now tracking a moving target under drift).

---

## What NOT to do (learned the hard way this project)

- **Don't test whether `detected_dtc` helps by simulating deterministic
  label→DTC assignment and measuring accuracy.** This was tried and
  gave a fake 100% from label leakage. The only valid test is Step 2's
  real retrain-and-holdout-evaluate.
- **Don't let any synthetic row into the test set**, ever, for any
  reported number.
- **Don't alter real data values** to make results look stronger —
  every synthetic row in `questionnaire_final_v3.csv`/`obd_final_v3.csv`
  is clearly flagged (`source` column); real rows are untouched.
- **Don't claim the `detected_dtc` field is device-captured** in the
  paper — it's expert-informed, and that's a meaningfully different
  (though still legitimate) kind of evidence. Say so explicitly.

---

## Priority order if time is short

1. Bayesian fix (Step 1) — blocks the most reviewer-sensitive part of the paper
2. Retrain + real-holdout evaluation (Step 2) — the core accuracy numbers
3. Simulation re-run (Step 3) — the dispatch-performance numbers
4. Production Bayesian convergence re-run (Step 4) — nice to have, the
   reference-implementation numbers (§7.3) are already citable if this
   doesn't finish in time

Send back whatever you complete, even partially — I'll integrate
incrementally rather than waiting for all four steps to finish.
