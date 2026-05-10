# Dispatch Optimization & Smart Recovery

**Owner:** Janukshan S (IT22635266)
**Component:** Uncertainty-Aware Dispatch Optimization (UADO) framework

## What this component does

Decides which roadside-assistance provider to send to which incident, treating dispatch as a stochastic optimization problem under service-type uncertainty. Consumes traffic-impact scores from `components/geo-intelligence/` to bias provider selection toward incidents with the highest traffic externality.

## Status

Skeleton — code to be migrated from `JanukshanS/R26-SE-026-Backend` and `JanukshanS/R26-SE-026-Frontend`.

## Stack (planned)

- Node.js + TypeScript
- PostgreSQL, Redis, RabbitMQ
- Python + scikit-learn for the Bayesian learning engine
- Google Maps API

## Contract

Exposes a REST API (see `contracts/dispatch.openapi.yaml` once published) for incident dispatch lifecycle.

## Consumes from other components

| Source | Data | Contract |
|---|---|---|
| `geo-intelligence` | Impact score (1–10) per incident | `POST /score` |
| `predictive-maintenance` | OBD-II + RUL signals | TBD |
| `claims-privacy` | Authentication + RBAC | API Gateway middleware |
