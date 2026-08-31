# Deployment

Four backend services on **one VPS**, behind Caddy, with Supabase as the
database. Everything is `docker-compose.yml` + `infra/Caddyfile`.

| Service | Container port | Public hostname |
|---|---|---|
| dispatch | 3001 | `dispatch.kaduna.lk` |
| geo-intelligence | 5001 | `geo.kaduna.lk` |
| predictive-maintenance | 5000 | `predict.kaduna.lk` |
| claims-privacy | 8000 | `claims.kaduna.lk` |

Only Caddy publishes ports (80/443). The services talk to each other over the
compose network by service name and are not reachable from the internet except
through Caddy.

## Server

2 vCPU / 4 GB RAM / 40 GB disk is enough for all four. Pick a Singapore region
for latency from Sri Lanka. Predictive-maintenance is the RAM driver: it loads
scikit-learn models on first use, roughly 250 MB resident for the four models
`/predict/best` needs and closer to 1 GB if `/predict/rf` and `/predict/gb` are
both exercised.

## Current deployment

Contabo VPS, 6 vCPU / 12 GB, Ubuntu 24.04, at `169.58.147.190`, checkout in
`/srv/kaduna`.

`kaduna.lk`'s A records still point elsewhere, so the live hostnames use
sslip.io, which resolves any `<anything>.169-58-147-190.sslip.io` to that IP
and still gets real Let's Encrypt certificates:

| Service | URL | Checked 2026-08-31 |
|---|---|---|
| dispatch | `https://dispatch.vps.kaduna.lk` | `/health` 200 |
| geo-intelligence | `https://geo.vps.kaduna.lk` | `/v1/health` 200 |
| predictive-maintenance | `https://predict.vps.kaduna.lk` | `/health` 200 |
| claims-privacy | `https://claims.vps.kaduna.lk` | 502 — service retired, see below |

The `*.169-58-147-190.sslip.io` hostnames this table used to list no longer
answer on 443 (port 80 responds 404, so Caddy is up but has no certificate or
route for them). The live deployment is on `*.vps.kaduna.lk`. Anything still
pointing at the sslip.io names — including a release build of the mobile app
— is talking to nothing.

claims-privacy returns 502 and that is expected: the service is retired. The
app reads claims straight from Supabase now (`apps/mobile/lib/claims-api.ts`),
so nothing depends on it.

To move to the real domain: add A records for `dispatch`, `geo`, `predict` and
`claims` pointing at the VPS, remove `BASE_DOMAIN` from `.env`, redeploy.
Caddy issues certificates on the first request to each hostname, so the
records must resolve first.

## First-time setup

```bash
# On the VPS
curl -fsSL https://get.docker.com | sh
git clone https://github.com/JanukshanS/R26-SE-026.git /srv/kaduna
cd /srv/kaduna
cp .env.example .env && $EDITOR .env      # then: chmod 600 .env
docker compose up -d --build
```

**Docker needs IPv6 enabled.** Supabase's direct database endpoint
(`db.<ref>.supabase.co`) resolves to IPv6 only. The compose network asks for
IPv6, but the daemon has to allow it, otherwise dispatch and claims-privacy
fail with "network is unreachable" while the same lookup works from the host:

```json
/* /etc/docker/daemon.json */
{ "ipv6": true, "fixed-cidr-v6": "fd00:babe::/64", "ip6tables": true }
```

`systemctl restart docker` afterwards, and recreate the stack
(`docker compose down && docker compose up -d`) so the network is rebuilt —
an existing network keeps its old IPv4-only settings.

## Redeploying

```bash
bash /srv/kaduna/scripts/deploy.sh main
```

Pulls, rebuilds only what changed, restarts, waits for healthchecks, and exits
non-zero if anything is still unhealthy after ~150 s.

Pushing to `main` runs the same script automatically via
`.github/workflows/deploy.yml`. It needs three repository secrets:
`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

## Configuration

`.env` at the repo root is read by compose (`env_file`) and is gitignored.
`.env.example` lists every key. Two things worth knowing:

- **Both database URLs must be the direct Supabase connection (port 5432)**,
  not the pooled one (6543). `prisma migrate deploy` runs on dispatch container
  start and cannot go through pgbouncer.
- **`DISPATCH_DATABASE_URL` and `CLAIMS_DATABASE_URL` are separate on purpose.**
  Dispatch is Prisma and takes `?schema=dispatch`; claims-privacy is psycopg
  and libpq rejects `?schema=` as an unknown parameter, so its URL carries no
  query string. Compose maps each to that service's own `DATABASE_URL`.
- **`SUPABASE_URL` is the project URL and nothing else.** All four services
  verify bearer tokens against that project's JWKS endpoint, so no key or
  secret is involved. If it is unset a service answers 503 rather than
  serving requests unauthenticated — compose refuses to start without it.
- Mobile Supabase credentials are **not** here — they live in
  `apps/mobile/.env` for local runs and in EAS environment variables for cloud
  builds. See `apps/mobile/.env.example`.

## Authentication

Every service requires `Authorization: Bearer <supabase-access-token>` on its
data routes. Health endpoints stay open so container healthchecks and
`deploy.sh` can reach them without credentials.

Tokens are the ES256 access tokens Supabase Auth issues. Each service fetches
the project's public keys from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
and verifies signature, issuer, audience and expiry. No service holds a secret,
and there is no gateway to misconfigure.

| Caller | How it gets a token |
|---|---|
| mobile | existing Supabase session, attached per request |
| kaduna-web | sign-in gate; any authenticated user, no role check yet |
| dispatch → geo | forwards the caller's `Authorization` header verbatim |

Consequences worth knowing before rollout:

- **The emergency incident flow now requires sign-in.** A guest report to
  dispatch answers 401. That is what applying one auth scheme everywhere
  means; if guest reporting must work, dispatch needs a public route carved
  out deliberately.
- Any signed-in Supabase user can open the dashboard. Role-gating belongs on
  `profiles.role` and is not implemented.

## What is not deployed here

- `apps/kaduna-web` (Next.js) — host on Vercel. It needs
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY`, `NEXT_PUBLIC_GEO_URL`
  and `NEXT_PUBLIC_DISPATCH_URL` set at build time; see its `.env.example`.
- `apps/mobile` (Expo) — built and distributed through EAS.
- Auth — Supabase Auth (GoTrue). The old `components/auth` and
  `components/vehicle-service` were removed; mobile talks to Supabase directly.
