# Contracts

OpenAPI 3.1 specifications and shared schema definitions that components publish for each other (and for the apps) to consume. The contracts under here are the **source of truth** for inter-component communication.

## Conventions

- One file per component: `<component>.openapi.yaml`
- Versioned routes: prefix with `/v1`, `/v2` etc.; never break a published route
- All endpoints return JSON; error shape is `{ "error": { "code": ..., "message": ..., "details": ... } }`
- Authentication: bearer JWT issued by the `claims-privacy` API Gateway; document required scopes per endpoint
- Standard headers: `X-Request-Id` (UUID, propagated through downstream calls)

## Publishing a new contract

1. Drop the spec file here (`<component>.openapi.yaml`)
2. Add a row to the table below
3. Open a PR; the component owner is the required reviewer
4. Apps may not depend on a contract until it's merged

## Published contracts

| Component | File | Status |
|---|---|---|
| auth | `auth.openapi.yaml` | published |
| dispatch | `dispatch.openapi.yaml` | published |
| geo-intelligence | `geo-intelligence.openapi.yaml` | published |
| predictive-maintenance | `predictive-maintenance.openapi.yaml` | published |
| vehicle-service | _superseded by `auth`_ | n/a |
| claims-privacy | _to be added_ | pending |
