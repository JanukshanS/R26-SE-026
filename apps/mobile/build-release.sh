#!/usr/bin/env bash
# Release APK build.
#
# Stashes .env.local first: Expo gives it higher precedence than .env, so
# leaving it in place ships EXPO_PUBLIC_DISPATCH_URL=http://localhost:3001 in a
# release build and the APK is dead in the field. The trap puts it back even if
# gradle fails or the build is interrupted.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# Absolute paths: the build cds into android/, and the trap fires from there.
restore() { [ -f "$HERE/.env.local.off" ] && mv -f "$HERE/.env.local.off" "$HERE/.env.local"; }
trap restore EXIT INT TERM

[ -f .env.local ] && mv .env.local .env.local.off

cd android
JAVA_HOME=/home/icy/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2 \
ANDROID_HOME=/home/icy/Android/Sdk \
  ./gradlew assembleRelease --no-daemon
