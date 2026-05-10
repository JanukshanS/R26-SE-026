# services

One HTTP client per backend component. Each service exposes typed functions that map 1:1 to the OpenAPI contract published in `Main-Repo/contracts/`.

## Files

| File | Purpose |
|---|---|
| `api-client.ts` | Base axios/fetch instance with timeouts, error normalisation, request-ID propagation |
| `geo-intelligence.ts` | Calls `components/geo-intelligence/`'s API (impact scores, hotspots) |
| `dispatch.ts` | Calls `components/dispatch/`'s API (request help, dispatch status) |
| `claims.ts` | Calls `components/claims-privacy/`'s API (3D claim lifecycle) |

## Conventions

- One file per backend component
- Each function takes a typed input, returns a typed output, throws on non-2xx
- Errors normalised to a single `ApiError` shape: `{ code, message, details? }`
- All requests carry an `X-Request-Id` header (UUID) for distributed tracing
- Authentication: bearer JWT (issued by claims-privacy gateway) — set in `api-client.ts` from a token store

## Adding a new service

1. Look up the contract in `Main-Repo/contracts/<component>.openapi.yaml`
2. Generate types via `openapi-typescript` (TBD as part of build tooling)
3. Add typed wrapper functions in `services/<component>.ts`
4. Re-export from `services/index.ts`

## What does NOT belong here

- React hooks that call services → `hooks/` or feature `hooks/`
- UI components → `components/`
- Cached query state → use TanStack Query in features that need it
