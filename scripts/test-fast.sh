#!/usr/bin/env bash
# scripts/test-fast.sh — fast suite: geo pytest + dispatch vitest. No device, no DB, no network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "── geo-intelligence (pytest) ──"
( cd "$ROOT/components/geo-intelligence" && .venv/bin/python -m pytest -q )

if [[ "${FAST_SKIP_DISPATCH:-}" != "1" ]]; then
  echo "── dispatch (vitest) ──"
  ( cd "$ROOT/components/dispatch" && npm test -- --run )
fi

echo "── ALL FAST TESTS PASSED ──"
