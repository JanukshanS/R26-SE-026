#!/usr/bin/env bash
# When `./gradlew clean` fails on :app:externalNativeBuildCleanDebug with CMake "add_subdirectory ...
# which is not an existing directory", native clean has deleted codegen jni folders while the app
# CMake step still tries to reconfigure. Nuke CMake caches + generated codegen, then rebuild.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID="$FRONTEND/android"

echo "Removing app CMake / build outputs..."
rm -rf "$ANDROID/app/.cxx" "$ANDROID/app/build"

echo "Removing shared android/build (optional intermediates)..."
rm -rf "$ANDROID/build"

echo "Removing codegen outputs under node_modules (recreated on next compile)..."
for pkg in \
  react-native-gesture-handler \
  react-native-reanimated \
  react-native-worklets \
  react-native-nitro-modules \
  react-native-screens \
  react-native-safe-area-context; do
  gen="$FRONTEND/node_modules/$pkg/android/build/generated"
  if [[ -d "$gen" ]]; then
    rm -rf "$gen"
  fi
done

echo "Stopping Gradle daemons..."
(cd "$ANDROID" && ./gradlew --stop) || true

echo "Done. From frontend/: npx expo run:android   (or: cd android && ./gradlew :app:assembleDebug)"
