#!/usr/bin/env bash
# One-click local dev launcher for Kaduna.lk (R26-SE-026).
#
# Starts, in the background:
#   geo-intelligence      http://localhost:5001  (FastAPI)
#   predictive-maintenance http://localhost:5000 (FastAPI)
#   dashboard-web         http://localhost:3000  (Next.js)
#   mobile (Expo web)     http://localhost:8081  (Expo/React Native)
#
# NOT started here: dispatch and claims-privacy. Both need a running
# Postgres (dispatch also needs Redis) which this script doesn't manage.
# Once you have Postgres/Redis available, see the commented-out section
# near the bottom for how to bring them up too.
#
# Usage:  bash start-dev.sh
# Stop:   Ctrl+C (all child services are killed together)

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

GEO_DIR="$ROOT_DIR/components/geo-intelligence"
PM_DIR="$ROOT_DIR/components/predictive-maintenance"
WEB_DIR="$ROOT_DIR/apps/dashboard-web"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

# predictive-maintenance ships compiled scikit-learn wheels. If this repo
# sits deep under a path like ".../OneDrive/.../R26-SE-026/..." the combined
# path to those .pyd files can exceed Windows' ~260 char limit even with
# long-path support on, and joblib.load() fails with "filename or extension
# is too long". Keeping this one venv shallow (in $HOME) sidesteps that.
PM_VENV="$HOME/.kaduna-pm-venv"

PIDS=()

cleanup() {
  echo
  echo "Stopping services..."
  for pid in "${PIDS[@]:-}"; do
    # uvicorn --reload, pnpm dev, and expo/Metro all spawn child processes;
    # a plain `kill` only signals the parent and leaves orphans holding the
    # port. taskkill //T kills the whole tree.
    taskkill //F //T //PID "$pid" >/dev/null 2>&1
  done
}
trap cleanup EXIT INT TERM

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool on PATH: $1"; exit 1; }
}
require python
require node
require npm
require pnpm

wait_for() {
  # wait_for <name> <url> <timeout_seconds>
  local name="$1" url="$2" timeout="${3:-60}" waited=0
  while ! curl -s -o /dev/null "$url"; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      echo "  [$name] not responding yet after ${timeout}s — check $LOG_DIR/$name.log"
      return 1
    fi
  done
  echo "  [$name] ready -> $url"
}

echo "== geo-intelligence =="
if [ ! -d "$GEO_DIR/.venv" ]; then
  echo "  creating venv..."
  python -m venv "$GEO_DIR/.venv"
fi
"$GEO_DIR/.venv/Scripts/python.exe" -m pip install --quiet -r "$GEO_DIR/requirements.txt"
(
  cd "$GEO_DIR" || exit 1
  exec "./.venv/Scripts/python.exe" -m uvicorn src.api:app --port 5001
) > "$LOG_DIR/geo-intelligence.log" 2>&1 &
PIDS+=("$!")

echo "== predictive-maintenance =="
if [ ! -d "$PM_VENV" ]; then
  echo "  creating venv at $PM_VENV..."
  python -m venv "$PM_VENV"
fi
"$PM_VENV/Scripts/python.exe" -m pip install --quiet -r "$PM_DIR/requirements.txt"
(
  cd "$PM_DIR" || exit 1
  exec "$PM_VENV/Scripts/python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 5000
) > "$LOG_DIR/predictive-maintenance.log" 2>&1 &
PIDS+=("$!")

echo "== dashboard-web =="
[ -d "$WEB_DIR/node_modules" ] || (cd "$WEB_DIR" && pnpm install)
(
  cd "$WEB_DIR" || exit 1
  exec pnpm dev
) > "$LOG_DIR/dashboard-web.log" 2>&1 &
PIDS+=("$!")

echo "== mobile (Expo web) =="
# Mobile switched from npm to pnpm at some point (pnpm-lock.yaml vs
# package-lock.json) — detect which this checkout uses instead of hardcoding.
if [ -f "$MOBILE_DIR/pnpm-lock.yaml" ]; then
  MOBILE_PKG_MGR=pnpm
else
  MOBILE_PKG_MGR=npm
fi
[ -d "$MOBILE_DIR/node_modules" ] || (cd "$MOBILE_DIR" && "$MOBILE_PKG_MGR" install)
[ -f "$MOBILE_DIR/.env" ] || { [ -f "$MOBILE_DIR/.env.example" ] && cp "$MOBILE_DIR/.env.example" "$MOBILE_DIR/.env"; }
(
  cd "$MOBILE_DIR" || exit 1
  exec npx expo start --web
) > "$LOG_DIR/mobile-web.log" 2>&1 &
PIDS+=("$!")

echo
echo "Waiting for services to come up (logs in $LOG_DIR)..."
wait_for geo-intelligence "http://localhost:5001/v1/health" 60
wait_for predictive-maintenance "http://localhost:5000/health" 60
wait_for dashboard-web "http://localhost:3000" 60
wait_for mobile-web "http://localhost:8081" 90

cat <<EOF

Kaduna.lk dev stack is running:
  geo-intelligence       http://localhost:5001/docs
  predictive-maintenance http://localhost:5000/docs
  dashboard-web          http://localhost:3000
  mobile (Expo web)      http://localhost:8081

Not started (need Postgres, dispatch also needs Redis):
  dispatch          components/dispatch      (port 3001)
  claims-privacy    components/claims-privacy (port 8000)

Press Ctrl+C to stop everything.
EOF

# --- To also run dispatch + claims-privacy once you have Postgres/Redis ---
# 1. Start the databases, e.g.: docker compose up -d postgres redis
#    (or point DATABASE_URL/REDIS_URL in each service's .env at your own instances)
# 2. Dispatch:
#      cd components/dispatch && npm install && npx prisma generate && npx prisma migrate dev
#      npm run dev
# 3. Claims-privacy:
#      cd components/claims-privacy && python -m venv .venv
#      .venv/Scripts/pip install -r requirements.txt
#      bash run-dev.sh

wait
