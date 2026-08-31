#!/usr/bin/env bash
# Wire both demo phones to the services running on this laptop.
#
# Everything the phones talk to is reached over USB (`adb reverse`), not the
# LAN. That is deliberate: mesh/shared Wi-Fi commonly isolates clients from
# each other, which makes the laptop unreachable from the phone even on one
# SSID — and it fails at the worst possible moment. A cable cannot.
#
# Run this AFTER start-dev.sh (or after starting dispatch + both Metro
# bundlers by hand), with both phones plugged in and USB debugging authorised.
#
# Re-run it any time a phone shows "Failed to connect to localhost" — adb
# reverse tunnels drop silently, and re-adding them is the fix.

set -uo pipefail

# adb is not on PATH on this machine; the SDK lives on D:.
command -v adb >/dev/null 2>&1 || export PATH="/d/AndroidData/platform-tools:$PATH"
command -v adb >/dev/null 2>&1 || { echo "adb not found — check D:/AndroidData/platform-tools"; exit 1; }

PHONE_A_PKG="com.kaduna.app"            # Kaduna driver/provider app
PHONE_A_SCHEME="mobile"
PHONE_A_PORT=8081

PHONE_B_PKG="com.kaduna.obdsimulator"   # OBD-II simulator
PHONE_B_SCHEME="kadunaobdsim"
PHONE_B_PORT=8082

DISPATCH_PORT=3001

# Force-stop and relaunch an app straight against its bundler.
launch() {
  local serial="$1" pkg="$2" scheme="$3" port="$4" role="$5"
  echo "       launching $role against Metro on :$port"
  adb -s "$serial" shell am force-stop "$pkg" >/dev/null 2>&1
  adb -s "$serial" shell am start -a android.intent.action.VIEW     -d "$scheme://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$port" >/dev/null 2>&1
}

# `launch <serial> sim|app` — for a phone carrying both apps, once the tunnels
# above are already in place.
if [ "${1:-}" = "launch" ]; then
  case "${3:-}" in
    sim) launch "$2" "$PHONE_B_PKG" "$PHONE_B_SCHEME" "$PHONE_B_PORT" "OBD simulator" ;;
    app) launch "$2" "$PHONE_A_PKG" "$PHONE_A_SCHEME" "$PHONE_A_PORT" "Kaduna app" ;;
    *)   echo "usage: bash scripts/demo-phones.sh launch <serial> sim|app"; exit 1 ;;
  esac
  exit 0
fi

mapfile -t DEVICES < <(adb devices | awk '$2=="device"{print $1}')
if [ "${#DEVICES[@]}" -eq 0 ]; then
  echo "No authorised devices. Plug the phones in and accept the USB-debugging prompt."
  exit 1
fi
echo "Devices: ${DEVICES[*]}"
echo

# EVERY port on EVERY device, unconditionally.
#
# Tunnels are free and the roles are not fixed: a phone carrying both apps
# plays the simulator in one run and the provider in the next, and the driver
# and provider ends BOTH talk to dispatch. Tunnelling only the port that
# matched an installed package is what left a phone unable to reach dispatch
# while looking perfectly connected — the app loads from Metro fine and only
# the API calls fail, which reads as a server problem rather than a missing
# tunnel.
for serial in "${DEVICES[@]}"; do
  echo "  [$serial]"
  for port in $DISPATCH_PORT $PHONE_A_PORT $PHONE_B_PORT; do
    adb -s "$serial" reverse tcp:$port tcp:$port >/dev/null
  done
  echo "       tunnels: $(adb -s "$serial" reverse --list | awk '{print $2}' | tr '
' ' ')"

  # Confirm from the DEVICE, not the host. The host can always reach its own
  # services; only this proves the tunnel actually carries traffic.
  code="$(adb -s "$serial" shell "curl -s -m 8 -o /dev/null -w '%{http_code}' http://localhost:$DISPATCH_PORT/health" 2>/dev/null | tr -d '')"
  if [ "$code" = "200" ]; then
    echo "       dispatch reachable from the device (200)"
  else
    echo "       WARNING: dispatch NOT reachable from the device (got '${code:-no answer}')"
  fi

  has() { adb -s "$serial" shell pm list packages 2>/dev/null | grep -q "package:$1"; }
  sim=false; app=false
  has "$PHONE_B_PKG" && sim=true
  has "$PHONE_A_PKG" && app=true

  if $sim && $app; then
    # Both installed, so the role is genuinely ambiguous — say so rather than
    # guessing and launching the wrong one mid-demo.
    echo "       both apps installed; launch whichever you need:"
    echo "         simulator: bash scripts/demo-phones.sh launch $serial sim"
    echo "         kaduna:    bash scripts/demo-phones.sh launch $serial app"
  elif $sim; then
    launch "$serial" "$PHONE_B_PKG" "$PHONE_B_SCHEME" "$PHONE_B_PORT" "OBD simulator"
  elif $app; then
    launch "$serial" "$PHONE_A_PKG" "$PHONE_A_SCHEME" "$PHONE_A_PORT" "Kaduna app"
  else
    echo "       neither app installed"
  fi
done

cat <<MSG

Both phones should now be loading from this laptop.
If one shows a connection error, re-run this script — the tunnel dropped.
MSG
