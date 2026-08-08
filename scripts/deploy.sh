#!/usr/bin/env bash
# Redeploy the backend on the VPS: pull, rebuild changed images, restart.
# Run from anywhere: bash /srv/kaduna/scripts/deploy.sh [branch]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${1:-main}"

cd "$REPO_DIR"

if [[ ! -f .env ]]; then
  echo "error: $REPO_DIR/.env is missing. Copy .env.example and fill it in." >&2
  exit 1
fi

echo "==> Fetching $BRANCH"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

echo "==> Building and starting"
docker compose up -d --build --remove-orphans

echo "==> Pruning old images"
docker image prune -f >/dev/null

echo "==> Waiting for health"
for _ in $(seq 1 30); do
  unhealthy="$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$2 == "unhealthy" || $2 == "starting" {print $1}')"
  [[ -z "$unhealthy" ]] && break
  sleep 5
done

docker compose ps
[[ -n "${unhealthy:-}" ]] && { echo "warning: still not healthy: $unhealthy" >&2; exit 1; }
echo "==> Deployed $(git rev-parse --short HEAD) on $BRANCH"
