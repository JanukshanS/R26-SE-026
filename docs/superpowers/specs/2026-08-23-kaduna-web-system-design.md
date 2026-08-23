# Kaduna Web System — Design (approved 2026-08-23)

One web app (`apps/kaduna-web`, Next.js static export, Dokploy on kaduna.lk) that reuses the
mobile app's data paths verbatim: direct Supabase (RLS) for profiles/vehicles/claims, bearer-token
calls to dispatch/geo/predictive-maintenance. No new backend. Polling, not realtime. Thin API
client modules ported from `apps/mobile/lib` — contracts are the shared artifact; extract a shared
package only if drift hurts.

## Routes

| Route | Audience | Gate |
|---|---|---|
| `/` | public landing (done) | none |
| `/app` | driver portal: vehicles, incident history + live status, claims, vehicle health | session |
| `/provider` | provider portal: availability, job queue accept/decline, history | session + `provider_id` (else onboarding) |
| `/dashboard` | ops geo dashboard (exists) | role `ops` |
| `/admin` | user roles (via `admin_set_role` RPC), provider verification | role `ops` |
| `/report` | web incident reporting (triage flow, no OBD) | session |

## Auth & roles

`profiles.role ∈ driver | provider | ops` (CHECK constraint live). Migration
`web_roles_and_role_lockdown` (applied 2026-08-23): clients can update their own profile fields
but NOT `role` (column grant); `provider_id` stays client-writable because mobile provider
onboarding links it (known risk, existing model: a client can set an arbitrary provider_id —
dispatch trusts profiles.provider_id for ownership; accepted for now, listed for team review).
`is_ops()` security-definer helper; ops can SELECT all profiles; role changes only via
`admin_set_role(target, role)` RPC. Shared web gate: session provider + profile fetch +
`RequireAuth` wrapper per area. Email + Google (redirect flow live; One Tap pending the web
client ID from Google console).

## Theme

Warm light (landing's cream/orange language) for `/app`, `/provider`, `/report`, `/admin`.
Dashboard stays dark.

## Phases (each: one Opus subagent → review → deploy)

P1 auth shell + role gate + route skeletons → P2 provider portal → P3 driver portal →
P4 admin → P5 web reporting.
