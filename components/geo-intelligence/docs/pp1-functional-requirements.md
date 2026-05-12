# PP1 — Functional Requirements with Role Mapping and Evidence

**Owner:** Asath M M (IT22633422)
**Project:** R26-SE-026 — Kaduna.lk
**Component:** Geo-Intelligence & Traffic Impact Analysis
**Date:** 2026-05-12 (PP1 day)

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
| **FR-01** | Calculate an impact score (1–10) for any reported incident within 500 ms | Operator + Dispatcher | `src/impact_scoring.py::ImpactScoringModel.score()` ; refined SLSQP weights (CLF 0.500, LF 0.220, ISF 0.180, TVF 0.050, TF 0.050) | `POST /v1/score` returns in <50 ms locally; dashboard updates live in the what-if simulator |
| **FR-02** | Classify incidents into CRITICAL, HIGH, MEDIUM, or LOW priority | Operator + Dispatcher | `PriorityLevel` enum with thresholds at 8.0 / 5.0 / 3.0 | Priority filter chips on the dashboard map; `priority` field in the `/v1/score` response |
| **FR-03** | Predict queue length, vehicle-hours lost, and recovery time for each incident | Dispatcher + Fleet manager | `ImpactScoringModel.predict_congestion()` — Lighthill-Whitham-Richards shockwave model with jam-density 120 vph and capacity-loss-driven arrival/recovery dynamics | "Congestion Prediction" panel on every incident detail card; `congestion.{queue_km, vehicle_hours_lost, recovery_minutes}` in the API response |
| **FR-04** | Display incidents on an interactive map with colour-coded severity markers | Operator | `dashboard/src/components/Map.tsx` (Next.js 16 + Leaflet.js); pulls `incidents.json` | Live map render at `localhost:3000` |
| **FR-05** | Provide a heatmap overlay showing incident density weighted by impact score | Operator | Same Map component; `leaflet.heat` weighted by `impactScore` | Toggle heatmap chip on the dashboard |
| **FR-06** | Identify and display hotspot zones using spatial clustering | Operator | `src/hotspot_analysis.py` — KDE + DBSCAN (haversine, eps=0.5 km, min_samples=4); 9 clusters on the 500-incident dataset | Hotspot overlay toggle; `GET /v1/hotspots` returns the 9 ranked clusters |
| **FR-07** | Provide a what-if simulator for hypothetical incident analysis | Fleet manager + Operator | `dashboard/src/components/WhatIfSimulator.tsx` ; client-side scoring using `model.json` config | What-if panel on the dashboard — adjust road type, lanes, blocked lanes, incident type, hour; score updates live |
| **FR-08** | Expose a REST API for integration with the dispatch engine | Dispatcher (Janukshan PP2) | `service/api.py` — FastAPI 1.0.0-pp1 ; OpenAPI 3.1 schema in `contracts/geo-intelligence.openapi.{json,yaml}` | `uvicorn service.api:app --port 8000` ; Swagger UI at `/docs` ; smoke test: `curl /v1/health` |
| **FR-09** | Support filtering incidents by priority level and road type | Operator | `dashboard/src/components/StatsPanel.tsx` + Map filter state | Priority + road-type filter chips on the dashboard |
| **FR-10** | Display detailed score breakdown and factor analysis for each incident | Operator | `dashboard/src/components/IncidentPanel.tsx` ; CLF/TVF/TF/LF/ISF bar chart per incident | Click any pin on the map → factor breakdown opens in side panel |

## Non-Functional Requirements (recap)

| ID | Category | Requirement | Evidence |
|----|---|---|---|
| **NFR-01** | Performance | Scoring API response time < 500 ms | Local benchmarks <50 ms p99 |
| **NFR-02** | Performance | Dashboard load time < 3 s | Next.js 16 static JSON read |
| **NFR-03** | Usability | Map renders smoothly with 50+ simultaneous incidents | Leaflet canvas renderer, all 500 pins rendered |
| **NFR-04** | Security | PDPA-compliant data handling with purpose limitation and consent | Stateless API, no PII in request/response payloads; consent flow is in the dispatch component (Janukshan) scope |
| **NFR-05** | Reliability | Scoring model Pearson r > 0.75 vs simulation ground truth | r = 0.904 (target exceeded by 20%) |
| **NFR-06** | Scalability | Architecture supports future integration with real-time traffic data APIs | FastAPI service can be containerised; in-memory model; OpenAPI contract published |
| **NFR-07** | Maintainability | Modular codebase with clear separation between data, analysis, presentation | `src/` (modelling) / `service/` (API) / `dashboard/` (UI) / `scripts/` (pipeline) / `data/` (artifacts) / `contracts/` (API spec) |

## Coverage summary

| FR | Demo path | PP1 status |
|----|---|---|
| FR-01..03 | Live scoring + API | ✅ Done |
| FR-04..07, FR-09..10 | Dashboard demo at `localhost:3000` | ✅ Done |
| FR-08 | FastAPI service at `localhost:8000` + OpenAPI 3.1 contract | ✅ Done (this PP1 cycle) |

PP1 covers **10/10 FRs**. Integration with the Dispatch component (consumer of FR-08) is on the PP2 roadmap.
