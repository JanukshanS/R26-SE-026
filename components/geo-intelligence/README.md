# Geo-Intelligence Component

**Owner:** Asath M M (IT22633422)

Traffic-impact intelligence for Sri Lankan roads. Wraps the impact-scoring model (5-factor weighted formula validated against SUMO microsimulation at Pearson r = 0.904) as a FastAPI service that the dashboard, mobile app, and dispatch component all consume.

## Status

Migrated from `RP/src/impact_scoring.py` on 2026-05-10. FastAPI wrapper and OpenAPI contract added in the same commit.

## Run

```bash
cd components/geo-intelligence
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api:app --reload --port 8080
```

Then:
- Auto-generated Swagger UI: http://localhost:8080/docs
- Alternative ReDoc: http://localhost:8080/redoc
- Health probe: `curl http://localhost:8080/v1/health`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/health` | Liveness check + active model weights |
| `POST` | `/v1/score` | Score one incident, return priority + factor breakdown + predicted queue/VHL/recovery |
| `GET` | `/v1/hotspots` | Return current Colombo hotspot clusters |
| `GET` | `/v1/stats` | Return precomputed dataset stats |

Full schema at `Main-Repo/contracts/geo-intelligence.openapi.yaml`. The Swagger UI is the easier read.

## Example: score an incident

```bash
curl -X POST http://localhost:8080/v1/score \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 6.9271,
    "longitude": 79.8612,
    "road_type": "primary",
    "total_lanes": 2,
    "lanes_blocked": 1,
    "incident_type": "engine_failure",
    "hour": 8,
    "day_of_week": 0
  }'
```

Returns:

```json
{
  "score": 6.5,
  "priority": "HIGH",
  "factors": {
    "capacity_loss": 0.5,
    "traffic_volume": 0.6,
    "temporal": 1.0,
    "location": 0.7,
    "incident_severity": 0.5
  },
  "prediction": {
    "queue_km": 1.5,
    "vehicle_hours_lost": 45.0,
    "recovery_min": 12.0
  }
}
```

## Source of truth

- **Scoring logic:** `src/impact_scoring.py` — refined weights baked in (`WEIGHTS` constant). Original `INITIAL_WEIGHTS` preserved for the before/after comparison.
- **Hotspot logic:** `src/hotspot_analysis.py` — KDE + DBSCAN (haversine, eps=0.5 km, min_samples=4). Produces the 9 clusters in `data/hotspot_results.csv` and `data/hotspots.json`.
- **SUMO validation:** `src/sumo_simulation.py` + `scripts/refine_model.py` — 90 scenarios; SLSQP optimisation lifted r from 0.552 → 0.904. Raw results in `data/sumo_results.csv`, refined weights in `data/refined_weights.csv`.
- **Refined weights** (CLF=0.500, LF=0.220, ISF=0.180, TVF=0.050, TF=0.050) come from the SLSQP optimisation against SUMO ground truth. The dashboard's `apps/dashboard-web/public/data/model.json` declares `weightsProvenance` to make this audit-able from the UI side.
- **API contract:** `contracts/geo-intelligence.openapi.{json,yaml}` — exported from this FastAPI service. Use this as the integration contract for the Dispatch component.

## PP1 documentation

See `docs/` for the panel-facing artifacts (all dated 2026-05-12):

- `pp1-functional-requirements.md` — FR-01..10 mapped to role + implementation + demo evidence.
- `pp1-risk-register.md` — rubric-aligned risk table (8 active risks + 4 closed).
- `pp1-panel-feedback-closure.md` — response to PF-1 / PF-2 / PF-3 from March proposal panel.
- `pp1-study-guide.md` — long-form deep dive for viva preparation.
- `pp1-pocket-reference.md` — stand-alone reference (carry into the room).

## Roadmap

| When | What |
|---|---|
| PP1 (now) | This component shipped — stateless scoring + static hotspots |
| Phase 1 (post-PP1) | Add `POST /v1/dispatch-comparison` for SO6 priority-vs-distance experiment |
| Phase 1 | Wire the dashboard to call this API instead of reading static JSON |
| Phase 2 | Add real-time hotspot recomputation, integration tests against SUMO ground truth |

## Testing

```bash
# Smoke test against a running server
curl -s http://localhost:8080/v1/health | python -m json.tool
curl -s http://localhost:8080/v1/hotspots | python -m json.tool | head
```

A proper pytest suite goes under `tests/` post-PP1.
