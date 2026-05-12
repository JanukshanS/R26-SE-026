#!/usr/bin/env bash
# Start FastAPI so phones on your Wi‑Fi can reach it (listens on all interfaces).
# From repo root: bash backend/run-dev.sh   OR   cd backend && ./run-dev.sh
set -euo pipefail
cd "$(dirname "$0")"
echo "Listening on http://0.0.0.0:8000 — use http://<this-machine-LAN-IP>:8000 in frontend/.env"
exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
