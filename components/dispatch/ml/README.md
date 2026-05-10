# UADO Diagnostic Triage — ML Pipeline

This folder contains the offline machine-learning pipeline that produces the
diagnostic decision tree used by the dispatch service's triage engine.

## What's here

| File | Stage | Purpose |
|------|-------|---------|
| `generate_dataset.py` | 1 | Generates a Sri Lanka-flavoured synthetic dataset of roadside incidents (Q1–Q8 + OBD telemetry → service_type label). |
| `train_compare.py`    | 2 | Trains a `DecisionTreeClassifier` (primary) and a `RandomForestClassifier` (comparison baseline). Reports metrics, exports the trained tree as JSON for the TypeScript engine to consume. |
| `data/`               | — | Generated CSV datasets (gitignored, regeneratable). |
| `reports/`            | — | Metrics, confusion-matrix plots, decision-tree visualization (gitignored). |
| `exported_tree.json`  | — | The portable decision-tree artifact consumed by `src/services/triage-engine.ts`. |

## Quick start

```bash
# from components/dispatch/ml
python -m venv .venv
.venv\Scripts\activate         # Windows / PowerShell
pip install -r requirements.txt

# Stage 1 — generate the dataset (100 incidents by default)
python generate_dataset.py --n 100 --seed 42

# Stage 2 — train and compare the two models
python train_compare.py
```

## Why these two models?

- **Decision Tree (primary):** interpretable, exportable to JSON for the
  TypeScript triage engine, audit-friendly. Required for PDPA-compliant
  dispatch decisions where every prediction must be traceable.
- **Random Forest (comparison):** the de-facto strongest off-the-shelf
  classifier on small tabular datasets. Acts as the "ML upper bound" — if our
  decision tree comes within a few percent of RF accuracy, we accept the
  trade-off in favour of interpretability.

## Notes

- Initial dataset size is **100 incidents** for rapid iteration. Re-run with
  `--n 1000` for the final thesis evaluation simulation (matches proposal §3.6).
- Dataset is regenerated deterministically from `--seed`; same seed = same data.
- OBD signal blocks are sampled from the team-provided
  `docs/synthetic_telemetry_data.csv`, partitioned by failure flag, to ensure
  realistic value distributions.
