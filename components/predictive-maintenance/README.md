# Predictive Maintenance for Service Management

**Owner:** Herath D M S T (IT22639776)

## What this component does

Predicts the Remaining Useful Life (RUL) of critical vehicle components — tyres, brakes, oil, battery — by combining three data sources: OBD-II telemetry, smartphone-sensed driver behaviour, and historical service records. Produces composite health indicators (0–100) and cost-optimised maintenance schedules.

## Status

Skeleton — code to be migrated from member's local environment.

## Stack (planned)

- Python (FastAPI, SQLite)
- scikit-learn (Random Forest, Gradient Boosting)
- PuLP (LP/MILP for fleet scheduling)
- ELM327 OBD-II Bluetooth adapter integration
- React Native (shares `apps/mobile/`)

## Contract

Exposes a REST API (to be published in `contracts/predictive-maintenance.openapi.yaml`):

| Endpoint | Purpose |
|---|---|
| `POST /telemetry` | Ingest OBD-II readings |
| `GET /health/:vehicleId` | Composite health indicators |
| `GET /schedule/:vehicleId` | Recommended maintenance schedule |

## Provides to other components

| Target | Data | Purpose |
|---|---|---|
| `dispatch` | OBD-II fault codes, battery voltage, RUL | Improves diagnostic confidence |
