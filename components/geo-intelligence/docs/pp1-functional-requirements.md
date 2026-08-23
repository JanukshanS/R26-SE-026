# PP1 — Functional Requirements with Role Mapping and Evidence

**Owner:** Asath M M (IT22633422)
**Project:** R26-SE-026 — Kaduna.lk
**Component:** Geo-Intelligence & Traffic Impact Analysis
**Date:** 2026-05-12 (PP1 day)
**Last verified against code:** 2026-08-19

This document maps each Functional Requirement from the proposal to (a) the primary user role that needs it, (b) the implementation artifact that satisfies it, and (c) the live evidence that demonstrates it during the PP1 demo.

The role taxonomy is the same one used in the Canva deck:

| Role | Who they are |
|---|---|
| **Operator** | Traffic-authority operations centre staff — needs situational awareness, hotspot staging, KPIs |
| **Dispatcher** | Kaduna.lk dispatch console (the Janukshan component, PP2) — needs a numeric priority signal + congestion prediction to break ties |
| **Fleet manager** | Logistics / ride-hailing / corporate fleet ops — needs what-if analysis for corridor risk |
| **Driver** | End-user via the future mobile channel (PP2 roadmap) — not addressed in PP1 |

## Functional Requirements

| ID | Requirement | Primary role | Implementation | Demo evidence |
|----|---|---|---|---|
| **FR-01** | Calculate an impact score (1–10) for any reported incident within 500 ms | Operator + Dispatcher | `src/impact_scoring.py::ImpactScoringModel.score()` ; deployed **ORIGINAL expert weights** (CLF 0.25, TVF 0.25, TF 0.20, LF 0.15, ISF 0.15). The SUMO-fitted refined weight set is a sensitivity result and is **not** deployed — see NFR-05 | `POST /v1/score` returns in <50 ms locally; dashboard updates live in the what-if simulator |
| **FR-02** | Classify incidents into CRITICAL, HIGH, MEDIUM, or LOW priority | Operator + Dispatcher | `PriorityLevel` enum with thresholds at 8.0 / 5.0 / 3.0 | Priority filter chips on the dashboard map; `priority` field in the `/v1/score` response |
| **FR-03** | Predict queue length, vehicle-hours lost, and recovery time for each incident | Dispatcher + Fleet manager | `ImpactScoringModel.predict_congestion()` — a closed-form input-output (Newell cumulative-count) queueing surrogate, **not** a Lighthill-Whitham-Richards solver: the code has no fundamental diagram and no shockwave-speed term. Its constants are uncalibrated heuristics — jam density 120 **veh/km**, road capacity in **veh/h**, average delay = duration / 4, queue capped at 15 km | "Congestion Prediction" panel on every incident detail card; `prediction.{queue_km, vehicle_hours_lost, recovery_min}` in the `/v1/score` response. Predicted VHL over-estimates SUMO VHL by a **median of 20x** (range 0–357x), so it is a *relative* index, not an absolute figure |
| **FR-04** | Display incidents on an interactive map with colour-coded severity markers | Operator | `apps/kaduna-web/src/components/Map.tsx` (Next.js 16 + Leaflet.js); base layer pulls static `public/data/incidents.json`, the live overlay is scored through `POST /v1/score` | Live map render at `localhost:3000` |
| **FR-05** | Provide a heatmap overlay showing incident density weighted by impact score | Operator | Same Map component; `leaflet.heat` weighted by `impactScore` | Toggle heatmap chip on the dashboard |
| **FR-06** | Identify and display hotspot zones using spatial clustering | Operator | `src/hotspot_analysis.py` — KDE + DBSCAN (haversine, eps=0.5 km, min_samples=4); **25 clusters** on the 500-incident dataset, with 356 incidents (71.2%) left as noise | Hotspot overlay toggle; `GET /v1/hotspots` returns the 25 ranked clusters from `data/hotspots.json` |
| **FR-07** | Provide a what-if simulator for hypothetical incident analysis | Fleet manager + Operator | `apps/kaduna-web/src/components/WhatIfSimulator.tsx` ; client-side scoring using `public/data/model.json` config | What-if panel on the dashboard — adjust road type, lanes, blocked lanes, incident type, hour; score updates live |
| **FR-08** | Expose a REST API for integration with the dispatch engine | Dispatcher (Janukshan PP2) | `src/api.py` — FastAPI, app version 0.1.0 ; OpenAPI 3.1 schema in `contracts/geo-intelligence.openapi.{json,yaml}` | `uvicorn src.api:app --port 5001` ; Swagger UI at `/docs` ; smoke test: `curl /v1/health` — the only unauthenticated route; every other route needs `Authorization: Bearer <supabase-access-token>` |
| **FR-09** | Support filtering incidents by priority level and road type | Operator | `apps/kaduna-web/src/components/StatsPanel.tsx` + Map filter state | Priority + road-type filter chips on the dashboard |
| **FR-10** | Display detailed score breakdown and factor analysis for each incident | Operator | `apps/kaduna-web/src/components/IncidentPanel.tsx` ; CLF/TVF/TF/LF/ISF bar chart per incident | Click any pin on the map → factor breakdown opens in side panel |

## Non-Functional Requirements (recap)

| ID | Category | Requirement | Evidence |
|----|---|---|---|
| **NFR-01** | Performance | Scoring API response time < 500 ms | Local benchmarks <50 ms p99 |
| **NFR-02** | Performance | Dashboard load time < 3 s | Next.js 16 static JSON read |
| **NFR-03** | Usability | Map renders smoothly with 50+ simultaneous incidents | Leaflet canvas renderer, all 500 pins rendered |
| **NFR-04** | Security | PDPA-compliant data handling with purpose limitation and consent | Stateless API, no PII in request/response payloads; every route except `/v1/health` requires a verified Supabase bearer token (`src/auth.py`); consent flow is in the dispatch component (Janukshan) scope |
| **NFR-05** | Reliability | Scoring model Pearson r > 0.75 vs simulation ground truth | **Open — the deployed model does not meet this target.** Deployed ORIGINAL weights reach Pearson r = 0.5985 (Spearman ρ = 0.6744) against `speed_reduction_pct` on the 120-scenario SUMO grid. A SUMO-fitted refined weight set reaches r = 0.9255 (held-out CV r = 0.924, bootstrap 95% CI [0.885, 0.948]), but that is a **sensitivity result and is NOT deployed** — see the Correction record below. Reproduce with `RP/scripts/report_metrics.py` |
| **NFR-06** | Scalability | Architecture supports future integration with real-time traffic data APIs | FastAPI service can be containerised; in-memory model; OpenAPI contract published |
| **NFR-07** | Maintainability | Modular codebase with clear separation between data, analysis, presentation | `src/` (modelling + FastAPI service; there is no separate `service/` package) / `apps/kaduna-web/` (UI) / `scripts/` (model refinement) / `data/` (artifacts) / `contracts/` (API spec) |

## Correction record (2026-08-19)

The PP1 version of this document carried claims that do not hold against the code
or the current validation run. They are corrected above and listed here rather than
deleted, so the change is auditable.

| Claim as written at PP1 | Status | What is true |
|---|---|---|
| NFR-05: "r = 0.904 (target exceeded by 20%)" | **Withdrawn** | That figure came from an earlier, degenerate SUMO grid in which the factors were confounded. On the regenerated 120-scenario grid the deployed ORIGINAL weights score Pearson r = 0.5985 (Spearman ρ = 0.6744), so the self-set r > 0.75 target is **not met** and stays open. |
| FR-01: implementation uses "refined SLSQP weights (CLF 0.500, LF 0.220, ISF 0.180, TVF 0.050, TF 0.050)" | **Wrong on two counts** | Nothing is deployed with refined weights — `ImpactScoringModel()` defaults to the ORIGINAL expert set — and that particular vector is the fit from the dead grid. The current SUMO fit is `{CLF 0.500, TVF 0.050, TF 0.050, LF 0.071, ISF 0.329}`, which reaches in-sample r = 0.9255 (held-out CV r = 0.924, bootstrap 95% CI [0.885, 0.948]). It remains a **sensitivity result, not deployed**: adopting it regenerates every downstream score, which is a project decision, and only CLF (raw r 0.883) and ISF (raw r 0.797) are strongly identified — TVF/TF/LF (raw r 0.087 / 0.029 / 0.086) sit at floor weights. |
| FR-03: "Lighthill-Whitham-Richards shockwave model ... jam-density 120 vph" | **Withdrawn** | `predict_congestion()` is a closed-form input-output queueing surrogate with no fundamental diagram and no shockwave term; jam density is 120 **veh/km**, not vph. Its VHL output over-estimates SUMO by a median of 20x. |
| FR-06: "9 clusters" | **Superseded** | DBSCAN on the 500-incident dataset yields **25 clusters** and 356 noise points (71.2%) at eps_km = 0.5, min_samples = 4. |
| FR-08: "`service/api.py` … `--port 8000`" | **Wrong path and port** | The service is `src/api.py` and listens on **5001** (`GEO_INTELLIGENCE_URL` in dispatch). There is no `service/` package. |

Closing NFR-05 needs either the refined weights adopted as the deployed default
(and every artifact regenerated) or the model re-specified; both are open work, not
PP1 claims. The 500 incidents are synthetic, placed on real Colombo OSM geometry.
Canonical figures come from `RP/scripts/report_metrics.py` — quote nothing it does
not print.

## Coverage summary

| FR | Demo path | PP1 status |
|----|---|---|
| FR-01..03 | Live scoring + API | ✅ Done |
| FR-04..07, FR-09..10 | Dashboard demo at `localhost:3000` | ✅ Done |
| FR-08 | FastAPI service at `localhost:5001` + OpenAPI 3.1 contract | ✅ Done (this PP1 cycle) |

PP1 covers **10/10 FRs**. Integration with the Dispatch component (consumer of FR-08) is on the PP2 roadmap.
