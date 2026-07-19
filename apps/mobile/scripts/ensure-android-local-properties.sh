#!/usr/bin/env bash
# Writes android/local.properties with sdk.dir so Gradle finds the Android SDK.
# android/local.properties is gitignored — each machine needs this once (or set ANDROID_HOME).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
OUT="$ANDROID_DIR/local.properties"

resolve_sdk() {
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    printf '%s' "$ANDROID_HOME"
    return 0
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
    printf '%s' "$ANDROID_SDK_ROOT"
    return 0
  fi
  local mac_default="${HOME}/Library/Android/sdk"
  if [[ -d "$mac_default" ]]; then
    printf '%s' "$mac_default"
    return 0
  fi
  return 1
}

SDK="$(resolve_sdk)" || {
  echo "Could not find Android SDK. Do one of the following:" >&2
  echo "  1) Install Android Studio and open SDK Manager (install Android SDK)." >&2
  echo "  2) export ANDROID_HOME=/path/to/Android/sdk" >&2
  echo "  3) Create $OUT with one line: sdk.dir=/path/to/Android/sdk" >&2
  exit 1
}

# Gradle expects escaped backslashes on Windows; forward slashes work on macOS/Linux.
printf 'sdk.dir=%s\n' "$SDK" >"$OUT"
echo "Wrote $OUT (sdk.dir=$SDK)"
