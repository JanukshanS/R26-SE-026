# Data dictionary — what travels, and the statuses it moves through

Companion to the container and dynamic views. Every value here was read out of the
code on `dev`, not out of prose.

## In-app statuses

### `IncidentStatus` — `components/dispatch/prisma/schema.prisma`

Carried on every dispatch response and drives which mobile/web screen the user lands on.

| Status | Set by | Screen effect |
|---|---|---|
| `CREATED` | `POST /api/v1/incidents` | triage flow opens |
| `TRIAGING` | triage in progress | question cascade |
| `DISPATCHING` | `POST /api/v1/triage/submit`, and again on a provider decline | "finding help" |
| `PROVIDER_ASSIGNED` | `POST /api/v1/dispatch/optimize` | `connected` screen, provider card + ETA |
| `EN_ROUTE` | `POST /api/v1/dispatch/respond {accepted: true}` | live provider status |
| `ON_SCENE` | provider on site | — |
| `RESOLVED` | `POST /api/v1/incidents/{id}/resolve` | closes the job |
| `ESCALATED` | resolve with a mismatching service type | closes the job |
| `CANCELLED` | driver abort | — |

`RESOLVED`, `ESCALATED` and `CANCELLED` are terminal — the web provider console stops
polling on them (`apps/kaduna-web/src/lib/dispatchApi.ts`).

Retrying an accept on an incident already `EN_ROUTE`/`ON_SCENE` returns 200 and writes
nothing, so a failed request is safe to resend. A decline does **not** auto-reoptimise:
the caller must POST `/dispatch/optimize` again or the incident sits unassigned.

### `ProviderStatus`

`AVAILABLE` · `BUSY` · `OFFLINE`. Only `AVAILABLE` providers enter the ECM ranking.
The web provider console sets `OFFLINE` on sign-out.

### `TriageTier`

`QUESTIONNAIRE_ONLY` · `OBD_ENHANCED` · `BAYESIAN_LEARNED` — how much evidence backed
the service-type probabilities returned to the app.

### `captures.status` (Supabase `public.captures`)

`uploading` → `processing` → `pending_review` → `approved`.
Driver-facing labels in `claimsApi.ts`: In Progress · Submitted · Pending Review · Approved.

## What each edge actually carries

| From → To | Payload | Transport |
|---|---|---|
| mobile → dispatch | GPS + vehicleInfo, triage responses, incidentId, provider response, resolution report | HTTPS, Supabase JWT in `Authorization` |
| dispatch → geo | `{lat, lng, incident_type, hour, day_of_week, road_type, total_lanes, lanes_blocked}` → impact score 1–10 | HTTPS, server-side, 2 s timeout |
| dispatch → PostgREST | ownership probe: `profiles.provider_id` for the **caller's own** row, using the **caller's own** token | HTTPS |
| mobile → predict | summarised trip (distance, duration, harsh-event counts, idle share) + DTC scan. Raw OBD/IMU samples are discarded on-device and never uploaded | HTTPS |
| ELM327 → mobile | live OBD-II PIDs + mode-03 DTCs; per-field fallback to the simulator when a PID doesn't answer | Bluetooth SPP / BLE |
| mobile → Edge Fn | capture metadata + client GPS, in exchange for a scoped presigned PUT | HTTPS |
| mobile → R2 | the photo/video bytes, streamed by `expo-file-system`, with `x-amz-meta-*` GPS headers | HTTPS PUT |
| web → geo | `/v1/hotspots`, `/v1/stats`, `/v1/score` — falls back to the bundled `public/data/*.json` when geo is unreachable | HTTPS |

## Two things this model corrects

1. **`components/claims-privacy` is retired.** `apps/mobile/lib/capture-api.ts` says so
   outright, and its two endpoints were ported 1:1 into the Supabase Edge Functions
   `sign-photo-upload` and `complete-capture`. The container is still deployed at
   `claims.vps.kaduna.lk` with **no callers** — it is drawn greyed and dashed.
2. **Predictive-maintenance is not SQLite in any deployed environment.**
   `app/database.py` defaults to `sqlite:///./predictive.db` for zero-setup local runs and
   tests only; `PREDICTIVE_DATABASE_URL` points at Supabase Postgres on its own
   `predictive` schema, over the **direct** 5432 connection (DDL is unreliable through
   the pooler).

## Standing limitations worth seeing on the diagram

- `geo-client.ts` still sends static `road_type` and `total_lanes`, so the location factor
  (15 % of the score weight) never moves. `lanes_blocked` *is* now derived from the triage
  service type, which unfroze the closure factor.
- Mobile reports a hardcoded `DEMO_VEHICLE` plate, so mobile-reported incidents don't
  plate-match real driver accounts in the web driver portal. The web `/report` flow sends
  the real plate.
- Claims have no read path from R2 — the UI shows counts, not thumbnails.
- `GET /incidents` is unscoped (accepted risk on record) and `provider_id` is
  client-writable.
