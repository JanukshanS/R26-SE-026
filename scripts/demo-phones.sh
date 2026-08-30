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

mapfile -t DEVICES < <(adb devices | awk '$2=="device"{print $1}')
if [ "${#DEVICES[@]}" -eq 0 ]; then
  echo "No authorised devices. Plug the phones in and accept the USB-debugging prompt."
  exit 1
fi
echo "Devices: ${DEVICES[*]}"

# Which app is on which phone decides which Metro port it needs, so ask the
# phone rather than hardcoding serials — they change when a cable does.
for serial in "${DEVICES[@]}"; do
  has() { adb -s "$serial" shell pm list packages 2>/dev/null | grep -q "package:$1"; }

  if has "$PHONE_B_PKG"; then
    pkg=$PHONE_B_PKG; scheme=$PHONE_B_SCHEME; port=$PHONE_B_PORT; role="OBD simulator"
  elif has "$PHONE_A_PKG"; then
    pkg=$PHONE_A_PKG; scheme=$PHONE_A_SCHEME; port=$PHONE_A_PORT; role="Kaduna app"
  else
    echo "  [$serial] neither app installed — skipping"
    continue
  fi

  echo "  [$serial] $role"
  adb -s "$serial" reverse tcp:$port tcp:$port >/dev/null
  # Dispatch, on both phones: the driver files the incident and the provider
  # polls for jobs, so both ends need it.
  adb -s "$serial" reverse tcp:$DISPATCH_PORT tcp:$DISPATCH_PORT >/dev/null
  echo "       tunnels: $(adb -s "$serial" reverse --list | awk '{print $2}' | tr '\n' ' ')"

  adb -s "$serial" shell am force-stop "$pkg" >/dev/null 2>&1
  adb -s "$serial" shell am start -a android.intent.action.VIEW \
    -d "$scheme://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$port" >/dev/null 2>&1
  echo "       launched against Metro on :$port"
done

cat <<MSG

Both phones should now be loading from this laptop.
If one shows a connection error, re-run this script — the tunnel dropped.
MSG
