#!/usr/bin/env bash
# scripts/test-fast.sh — fast suite: geo (python) unit. No device, no DB, no network.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "── geo (python) unit ──"
( cd "$ROOT/components/geo-intelligence" && .venv/bin/python -m pytest -q )
echo "── ALL FAST TESTS PASSED ──"
