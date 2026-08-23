# Geo-Intelligence Component

**Owner:** Asath M M (IT22633422)

Traffic-impact intelligence for Sri Lankan roads. Wraps a 5-factor weighted
impact-scoring model as a FastAPI service that the dashboard, mobile app, and
dispatch component consume. The score (1–10) feeds the dispatch optimizer's
traffic-externality term, so high-impact incidents are prioritised.

## Status

Re-synced from `RP/src/impact_scoring.py` on 2026-06-27 and runs the **deployed
ORIGINAL weights** (the single source of truth for every produced artifact).
The earlier copy had drifted to a stale weight variant — see *Model & validation*.

## Run

```bash
cd components/geo-intelligence
# .venv already provisioned (CPython 3.13). If recreating:
#   python -m venv .venv && .venv/bin/pip install -r requirements.txt
export SUPABASE_URL=https://<project>.supabase.co
.venv/bin/python -m uvicorn src.api:app --reload --host 0.0.0.0 --port 5001

# or keep it in a gitignored .env — uvicorn[standard] ships python-dotenv:
#   echo 'SUPABASE_URL=https://<project>.supabase.co' > .env
#   .venv/bin/python -m uvicorn src.api:app --host 0.0.0.0 --port 5001 --env-file .env
```

- Swagger UI: http://localhost:5001/docs  ·  Health: `curl http://localhost:5001/v1/health`
- Port **5001** is what the dispatch service expects (`GEO_INTELLIGENCE_URL`).
- `SUPABASE_URL` is required: without it every authenticated route answers **503**
  rather than running unauthenticated. No key or secret is needed — tokens are
  verified against the project's public JWKS.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/health` | Liveness + active model weights |
| `POST` | `/v1/score` | Score one incident → priority + factor breakdown + queue/VHL/recovery |
| `POST` | `/v1/score/uncertainty` | 90% confidence band on the score (Monte-Carlo over duration + lanes-blocked) |
| `POST` | `/v1/score/timeline` | Relative congestion-impact curve over time (rise-then-decay) |
| `GET`  | `/v1/hotspots` | Precomputed Colombo hotspot clusters |
| `GET`  | `/v1/stats` | Precomputed dataset stats |

## Authentication

Every route except `GET /v1/health` requires `Authorization: Bearer <supabase-access-token>`
— the ES256 access token Supabase Auth issues to the dashboard or mobile app, verified
against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (`src/auth.py`). Missing or bad
token → **401**; `SUPABASE_URL` unset → **503**.

Get a token for curl by signing in against your project's auth endpoint:

```bash
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .access_token)
```

**Error responses:** score routes return **400** when `lanes_blocked > total_lanes`
(`{ "detail": "lanes_blocked cannot exceed total_lanes" }`). `/v1/hotspots` and
`/v1/stats` return **503** when their JSON dataset is missing. v0.1 uses FastAPI
`{ detail }` bodies, not the platform error envelope.

`incident_type` accepts the public vocabulary (`major_accident`, `minor_accident`,
`engine_failure`, `flat_tire`, `fuel_empty`, `battery_dead`, `lockout`, `overheating`,
`other`); `major_accident`/`minor_accident` are aliased to the model's canonical
`accident_major`/`accident_minor` keys so they resolve to the correct severity rather
than the default. `lockout` and `other` use default ISF 0.5.

## Example

```bash
curl -X POST http://localhost:5001/v1/score \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "latitude": 6.9271, "longitude": 79.8612, "road_type": "primary",
  "total_lanes": 2, "lanes_blocked": 1, "incident_type": "engine_failure",
  "hour": 8, "day_of_week": 0 }'
```

```json
{
  "score": 7.5,
  "priority": "HIGH",
  "factors": { "capacity_loss": 0.5, "traffic_volume": 0.85, "temporal": 1.0,
               "location": 0.7, "incident_severity": 0.7 },
  "prediction": { "queue_km": 5.0, "vehicle_hours_lost": 150.0, "recovery_min": 30.0 }
}
```

## Model & validation

Deployed model = **ORIGINAL expert weights** `{CLF 0.25, TVF 0.25, TF 0.20, LF 0.15,
ISF 0.15}`. Validated against a 120-scenario SUMO microsimulation grid
(`speed_reduction_pct`): **Pearson r = 0.5985** (Spearman ρ = 0.6744).

A SUMO-fitted **refined** weight set `{CLF 0.500, TVF 0.050, TF 0.050, LF 0.071,
ISF 0.329}` reaches in-sample r = 0.9255 (held-out leave-one-road-type-out + 5-fold
CV r = 0.924, bootstrap 95% CI [0.885, 0.948]). **These are a sensitivity result,
NOT deployed** — `ImpactScoringModel()` defaults to the ORIGINAL weights; pass
`WEIGHTS_REFINED` only for comparison. Of the five factors, only **CLF (raw r 0.883)**
and **ISF (raw r 0.797)** are strongly data-identified; TVF/TF/LF are weak (raw r
0.087 / 0.029 / 0.086) and sit at floor weights.

The congestion prediction (`queue_km`, `vehicle_hours_lost`, `recovery_min`) is an
**uncalibrated** input-output queueing surrogate — not an LWR shockwave solver — whose
predicted VHL over-estimates SUMO VHL by a **median of 20x** (range 0–357x). Read it as
a *relative* index, not an absolute figure.

The 500 incidents in `data/` are **synthetic**, placed on real Colombo OSM geometry.

**Reproduce:** `RP/scripts/report_metrics.py` is the canonical source for every number
above — quote nothing it does not print. Run it with the RP venv:

```bash
/home/icy/ax/base-study/RP/venv/bin/python /home/icy/ax/base-study/RP/scripts/report_metrics.py
```

The weight fit and its cross-validation live beside it as `RP/scripts/refine_model.py`
and `RP/scripts/validate_weights_cv.py`. Where a copy of one of those scripts is also
vendored under this component's `scripts/`, it is a convenience mirror — the RP original
is the canonical version.

## Source of truth

- Scoring logic: `src/impact_scoring.py` — a clean copy of `RP/src/impact_scoring.py`, defaulting to ORIGINAL weights.
- Hotspots (`data/hotspots.json`) are precomputed by `RP/scripts/run_hotspot_analysis.py` and now hold the canonical **25 clusters** (DBSCAN `eps_km=0.5, min_samples=4`; 356 of 500 incidents, 71.2%, fall out as noise). `data/stats.json` matches the same run (500 incidents; CRITICAL 18 / HIGH 300 / MEDIUM 171 / LOW 11).

## Roadmap

| When | What |
|---|---|
| done | Re-sync to ORIGINAL weights; alias accident types; add uncertainty + timeline endpoints |
| done | Regenerate `data/hotspots.json`/`stats.json` to the canonical 25-cluster dataset |
| done | Supabase bearer auth on every route except `/v1/health` |
| done | Dashboard reads hotspots, stats and live incident scores from this API (`apps/dashboard-web/src/lib/geoData.ts`, `liveData.ts`), falling back to static JSON when the service is down |
| next | Move the dashboard's 500-incident base layer off `public/data/incidents.json` — it is the last static read |
| next | Calibrate the congestion prediction against SUMO so VHL is absolute rather than a relative index |
| later | Real-time hotspot recomputation; integration tests vs SUMO ground truth |

## Testing

```bash
curl -s http://localhost:5001/v1/health | jq .
curl -s -X POST http://localhost:5001/v1/score/uncertainty \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"latitude":6.9,"longitude":79.86,"road_type":"primary","total_lanes":2,"lanes_blocked":1,"incident_type":"accident_minor","hour":17,"day_of_week":2}'
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5001/v1/hotspots | jq 'length'
```
