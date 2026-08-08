#!/usr/bin/env bash
# One-click local dev launcher for Kaduna.lk (R26-SE-026).
#
# Starts, in the background:
#   geo-intelligence      http://localhost:5001  (FastAPI)
#   predictive-maintenance http://localhost:5000 (FastAPI)
#   dashboard-web         http://localhost:3000  (Next.js)
#   mobile (Expo web)     http://localhost:8090  (Expo/React Native)
#   mobile (Expo dev server, real QR — separate visible window) port 8081
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
  # Pinned off the default 8081 so it never races the QR-window instance
  # below for that port — both used to default to 8081, and whichever lost
  # the race silently landed on 8082, which broke `adb reverse` (hardcoded
  # to 8081) since it was tunneling the wrong instance's port.
  exec npx expo start --web --port 8090
) > "$LOG_DIR/mobile-web.log" 2>&1 &
PIDS+=("$!")

echo
echo "Waiting for services to come up (logs in $LOG_DIR)..."
wait_for geo-intelligence "http://localhost:5001/v1/health" 60
wait_for predictive-maintenance "http://localhost:5000/health" 60
wait_for dashboard-web "http://localhost:3000" 60
wait_for mobile-web "http://localhost:8090" 90

echo
echo "== mobile (Expo dev server — real QR, for Expo Go / a dev-client build) =="
# `npx expo start --web` above runs headless (output piped to a log file), so
# its QR code never renders. QR codes need a real TTY, so this launches a
# separate, visible terminal window instead. Not managed by this script's
# cleanup — close that window yourself when you're done with it.

# Find adb even before a shell restart has picked up winget's PATH change.
if ! command -v adb >/dev/null 2>&1; then
  ADB_CANDIDATE="$(find "$LOCALAPPDATA/Microsoft/WinGet/Packages" -maxdepth 2 -iname "platform-tools" -type d 2>/dev/null | head -1)"
  [ -n "$ADB_CANDIDATE" ] && export PATH="$ADB_CANDIDATE:$PATH"
fi

USB_DEVICE=""
if command -v adb >/dev/null 2>&1; then
  USB_DEVICE="$(adb devices 2>/dev/null | awk '$2=="device"{print $1; exit}')"
fi

WIN_MOBILE_DIR="$(cygpath -w "$MOBILE_DIR")"
QR_BAT="$LOG_DIR/run-expo-qr.bat"

if [ -n "$USB_DEVICE" ]; then
  # A device is connected and authorized over USB — tunnel through the cable
  # instead of the LAN. This sidesteps router AP/client isolation (common on
  # mesh/shared Wi-Fi) that blocks phone<->laptop traffic even on one SSID.
  echo "  USB device detected ($USB_DEVICE) — using adb reverse instead of Wi-Fi."
  adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1
  adb reverse tcp:5000 tcp:5000 >/dev/null 2>&1
  adb reverse tcp:5001 tcp:5001 >/dev/null 2>&1
  # Expo CLI does its OWN `adb devices` check (to decide "press a" should use
  # the USB-reversed localhost vs falling back to exp://<lan-ip>) — but this
  # window is a separate cmd.exe process that won't have adb on PATH unless
  # we put it there ourselves, since it doesn't inherit this script's PATH
  # exports. Without it, Expo CLI silently can't see the device and falls
  # back to the LAN IP even though the phone IS connected over USB.
  ADB_DIR="$(dirname "$(command -v adb)")"
  WIN_ADB_DIR="$(cygpath -w "$ADB_DIR")"
  cat > "$QR_BAT" <<BATEOF
@echo off
set "PATH=$WIN_ADB_DIR;%PATH%"
cd /d "$WIN_MOBILE_DIR"
set "EXPO_PUBLIC_MAINTENANCE_URL=http://localhost:5000"
set "EXPO_PUBLIC_API_URL=http://localhost:8000"
npx expo start
BATEOF
  echo "  Opened a new terminal window — press 'a' there to open on the connected device over USB."
else
  LAN_IP="$(node -e "console.log(Object.values(require('os').networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address)[0]||'')" 2>/dev/null)"
  if [ -n "$LAN_IP" ]; then
    echo "  No USB device found — falling back to Wi-Fi. LAN IP: $LAN_IP"
    echo "  Note: if your phone can't reach $LAN_IP (ERR_ADDRESS_UNREACHABLE), your router likely"
    echo "  isolates Wi-Fi clients from each other — plug the phone in via USB and re-run instead."
  else
    echo "  Could not auto-detect a LAN IP — set EXPO_PUBLIC_MAINTENANCE_URL/EXPO_PUBLIC_API_URL yourself if a real device can't reach localhost."
  fi
  # Write a real .bat file instead of nesting quotes through
  # bash -> cmd.exe //c -> start -> cmd //k (that path breaks: `start`'s own
  # argument parsing mangles nested quotes/spaces long before cmd /k sees them,
  # which is what threw "filename, directory name, or volume label syntax is
  # incorrect" — cd /d received a truncated path). A .bat file sidesteps all of
  # that: each line is parsed once, normally, by the same cmd.exe that runs it.
  cat > "$QR_BAT" <<BATEOF
@echo off
cd /d "$WIN_MOBILE_DIR"
set "EXPO_PUBLIC_MAINTENANCE_URL=http://$LAN_IP:5000"
set "EXPO_PUBLIC_API_URL=http://$LAN_IP:8000"
npx expo start
BATEOF
  echo "  Opened a new terminal window — scan the QR code it prints with Expo Go, or press 'a' once a dev-client build is installed on your phone."
fi

WIN_QR_BAT="$(cygpath -w "$QR_BAT")"
cmd.exe //c start "Expo Dev Server (scan QR here)" "$WIN_QR_BAT"

cat <<EOF

Kaduna.lk dev stack is running:
  geo-intelligence       http://localhost:5001/docs
  predictive-maintenance http://localhost:5000/docs
  dashboard-web          http://localhost:3000
  mobile (Expo web)      http://localhost:8090
  mobile (Expo dev server, real QR) — see the separate terminal window

Not started (both need a Postgres DATABASE_URL):
  dispatch          components/dispatch      (port 3001)
  claims-privacy    components/claims-privacy (port 8000)

Press Ctrl+C to stop everything.
EOF

# --- To also run dispatch + claims-privacy ---
# 1. Point DATABASE_URL in each service's .env at a Postgres instance — the
#    team's Supabase project is the easy one (Project Settings -> Database ->
#    Connection string, direct/5432 not the pooled 6543).
# 2. Dispatch:
#      cd components/dispatch && npm install && npx prisma generate && npx prisma migrate dev
#      npm run dev
# 3. Claims-privacy:
#      cd components/claims-privacy && python -m venv .venv
#      .venv/Scripts/pip install -r requirements.txt
#      bash run-dev.sh

wait
