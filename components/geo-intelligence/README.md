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
.venv/bin/python -m uvicorn src.api:app --reload --host 0.0.0.0 --port 5001
```

- Swagger UI: http://localhost:5001/docs  ·  Health: `curl http://localhost:5001/v1/health`
- Port **5001** is what the dispatch service expects (`GEO_INTELLIGENCE_URL`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/health` | Liveness + active model weights |
| `POST` | `/v1/score` | Score one incident → priority + factor breakdown + queue/VHL/recovery |
| `POST` | `/v1/score/uncertainty` | 90% confidence band on the score (Monte-Carlo over duration + lanes-blocked) |
| `POST` | `/v1/score/timeline` | Relative congestion-impact curve over time (rise-then-decay) |
| `GET`  | `/v1/hotspots` | Precomputed Colombo hotspot clusters |
| `GET`  | `/v1/stats` | Precomputed dataset stats |

`incident_type` accepts the public vocabulary (`major_accident`, `minor_accident`,
`engine_failure`, `flat_tire`, `fuel_empty`, `battery_dead`, …); `major_accident`/
`minor_accident` are aliased to the model's canonical `accident_major`/`accident_minor`
keys so they resolve to the correct severity rather than the default.

## Example

```bash
curl -X POST http://localhost:5001/v1/score -H "Content-Type: application/json" -d '{
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
(`speed_reduction_pct`): **Pearson r = 0.60** (Spearman ρ = 0.67).

A SUMO-fitted **refined** weight set `{CLF 0.500, TVF 0.050, TF 0.050, LF 0.071,
ISF 0.329}` reaches in-sample r = 0.93 (held-out leave-one-road-type-out + 5-fold
CV r = 0.924, bootstrap 95% CI [0.885, 0.948]). **These are a sensitivity result,
NOT deployed** — `ImpactScoringModel()` defaults to the ORIGINAL weights; pass
`WEIGHTS_REFINED` only for comparison. Of the five factors, only **CLF (raw r 0.88)**
and **ISF (raw r 0.80)** are strongly data-identified; TVF/TF/LF are weak (raw r
≈ 0.03–0.09) and sit at floor weights.

The congestion prediction (`queue_km`, `vehicle_hours_lost`, `recovery_min`) is an
**uncalibrated** input-output queueing surrogate that over-estimates SUMO VHL by
~1–2 orders of magnitude — read it as a *relative* index, not an absolute figure.

All numbers above are reproduced by `RP/scripts/report_metrics.py` (the canonical
source — quote nothing it does not print). Run it with `RP/venv/bin/python`.

## Source of truth

- Scoring logic: `src/impact_scoring.py` — a clean copy of `RP/src/impact_scoring.py`, defaulting to ORIGINAL weights.
- Hotspots (`data/hotspots.json`) are precomputed by `RP/scripts/run_hotspot_analysis.py`. The canonical cluster count is **25** (DBSCAN `eps_km=0.5, min_samples=4`, 71.2% noise); the shipped static file should be regenerated to match before any hotspot claim is demoed.

## Roadmap

| When | What |
|---|---|
| done | Re-sync to ORIGINAL weights; alias accident types; add uncertainty + timeline endpoints |
| next | Wire the dashboard to call this API instead of reading static JSON |
| next | Regenerate `data/hotspots.json`/`stats.json` to the canonical 25-cluster dataset |
| later | Real-time hotspot recomputation; integration tests vs SUMO ground truth |

## Testing

```bash
curl -s http://localhost:5001/v1/health | jq .
curl -s -X POST http://localhost:5001/v1/score/uncertainty -H 'Content-Type: application/json' \
  -d '{"latitude":6.9,"longitude":79.86,"road_type":"primary","total_lanes":2,"lanes_blocked":1,"incident_type":"accident_minor","hour":17,"day_of_week":2}'
```
