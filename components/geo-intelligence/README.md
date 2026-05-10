# Geo-Intelligence & Traffic Impact Analysis

**Owner:** Asath M M (IT22633422)

## What this component does

Quantifies the traffic-congestion impact of vehicular incidents on Sri Lankan roads. Returns a 1–10 priority score per incident plus a predicted queue length, vehicle-hours lost, and recovery time. Identifies spatial hotspots of incidents across the Colombo metropolitan area.

## Status

Skeleton — code to be migrated from `icy-r/kaduna-rp` (`src/impact_scoring.py`, `src/hotspot_analysis.py`, `src/sumo_simulation.py`, plus supporting scripts and data).

## Stack

- Python 3.14
- OSMnx (road network), SUMO (validation), scipy (SLSQP optimization), scikit-learn (DBSCAN, ML comparison baseline)
- pandas / numpy / matplotlib

## Headline result

Pearson r = 0.904 between formula scores and SUMO speed reduction (target: r > 0.75). See full methodology and caveats in the personal repo's `docs/slsqp-weight-refinement.md`.

## Contract

Exposes a REST API (to be published in `contracts/geo-intelligence.openapi.yaml`):

| Endpoint | Purpose |
|---|---|
| `POST /score` | Score a single incident |
| `GET /hotspots` | Return current Colombo hotspot clusters |
| `GET /comparison` | (planned) Priority-vs-distance dispatch comparison results |

## Consumed by

`components/dispatch/` — the impact score is the externality term in dispatch optimization.
`apps/dashboard-web/` — visualises incidents, hotspots, and what-if simulations.
