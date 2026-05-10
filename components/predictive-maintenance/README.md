# Predictive Maintenance for Service Management

**Owner:** Herath D M S T (IT22639776)

## What this component does

Predicts the Remaining Useful Life (RUL) of critical vehicle components — engine, brake pads, tyres, battery — using OBD-II–style telemetry and IMU-derived driving behaviour. Stores trip metrics in SQLite, serves composite health indicators, and exposes predictions over a FastAPI REST API.

## Status

FastAPI service with SQLite persistence and trained scikit-learn / XGBoost models under `models/`. Shared OpenAPI contract is intended to live under `contracts/predictive-maintenance.openapi.yaml` when published.

## Stack

- Python 3.11, FastAPI, Uvicorn, SQLAlchemy (SQLite)
- scikit-learn (Random Forest), XGBoost (gradient boosting)
- Postman: `predictive_maintenance.postman_collection.json` (base URL `http://localhost:5000`)

## How to run (local)

Prerequisites: Python 3.11+.

From this directory (`components/predictive-maintenance`):

**Windows (PowerShell)**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 5000
```

**macOS / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 5000
```

- API: [http://127.0.0.1:5000](http://127.0.0.1:5000)
- Swagger UI: [http://127.0.0.1:5000/docs](http://127.0.0.1:5000/docs)
- Health check: `GET /health`

SQLite creates `predictive.db` in the current working directory (`sqlite:///./predictive.db`).

### Train or refresh models (optional)

If `models/*.joblib`, `best_models.json`, or `metrics.json` are missing or you changed training data:

```bash
python train_models.py
```

Restart the server so `app.main` reloads the artefacts.

## Docker

The image runs Uvicorn on port **5000** (see `Dockerfile`).

**Build** (from this directory, so `models/` and `requirements.txt` are included):

```bash
docker build -t predictive-maintenance .
```

**Run**

```bash
docker run --rm -p 5000:5000 predictive-maintenance
```

Then open [http://localhost:5000/docs](http://localhost:5000/docs).

The database file is written inside the container filesystem under `/app/predictive.db` unless you arrange a different layout; for a simple smoke test the default is enough. For durable SQLite across restarts you would need a bind mount or volume and a consistent path (may require setting `DATABASE_URL` in code or env in a future change).

## Implemented API (summary)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service status and loaded models |
| POST | `/process-trip` | Ingest OBD + IMU batch, persist trip metrics |
| GET | `/vehicles/summary` | Summaries for all vehicles with trips |
| GET | `/vehicle/{vehicle_id}/rul` | RUL from stored trips (best model per component) |
| GET | `/vehicle/{vehicle_id}/health` | Health % derived from RUL |
| POST | `/predict/rf`, `/predict/gb`, `/predict/best` | RUL from request body features |
| GET | `/models/metrics` | Test-set metrics from `models/metrics.json` |

## Provides to other components

| Target | Data | Purpose |
| --- | --- | --- |
| `dispatch` | OBD-II–derived features, battery voltage, RUL | Improves diagnostic confidence |

## Related

- React Native app: `apps/mobile/`
- PuLP / fleet scheduling and ELM327 integration are roadmap items for this component.
