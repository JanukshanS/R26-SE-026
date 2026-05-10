# Infrastructure

Shared CI, deployment configuration, and Docker assets.

## Status

Skeleton. To be populated as components migrate in.

## Planned contents

- `ci/` — GitHub Actions workflows (per-component build + test, plus a top-level monorepo lint)
- `docker/` — base Dockerfiles and `docker-compose.yml` for running the full stack locally
- `k8s/` — Kubernetes manifests for staging / production (claims-privacy component leads on k8s)
- `env/` — `.env.example` files, never real secrets
