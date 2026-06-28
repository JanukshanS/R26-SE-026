#!/usr/bin/env bash
# Spine smoke test: incident -> triage -> dispatch.
# Proves the geo-intelligence impact score flows into the dispatch decision:
# no trafficImpactScore is sent, so the value must come from geo (source
# "geo-intelligence"), not dispatch's fallback default of 5.
#
# Prereqs: dispatch on :3001 (Postgres up + seeded) and geo on :5001.
# Usage: bash scripts/spine-smoke.sh
set -euo pipefail

D="${DISPATCH_URL:-http://localhost:3001}"

INC=$(curl -fsS -X POST "$D/api/v1/incidents" -H 'Content-Type: application/json' -d '{
  "location": { "latitude": 6.9271, "longitude": 79.8612 },
  "vehicleInfo": { "make": "Toyota", "model": "Corolla", "year": 2019, "fuelType": "PETROL" },
  "description": "Major crash on Galle Road"
}')
ID=$(jq -r '.data.id' <<<"$INC")
echo "1) incident: $ID"

TRIAGE='{
  "Q1_intent":"MAJOR_CRASH",
  "Q2_engine_start":"NOT_ASKED","Q2b_running_issue":"NOT_ASKED","Q3_sound":"NOT_ASKED",
  "Q3b_electrical":"NOT_ASKED","Q4_noise_detail":"NOT_ASKED","Q7_overheat_detail":"NOT_ASKED",
  "Q8_smoke_color":"NOT_ASKED","Q_brake_detail":"NOT_ASKED","Q_gear_detail":"NOT_ASKED",
  "Q6_smells":"NO_SMELL","Q5_lights":[],"Q9_recent":[],
  "location_type":"URBAN","recent_rain":"NONE","parked_overnight":"OUTDOOR",
  "vehicle_age_bucket":"3_7","last_fueled":"TODAY_USUAL"
}'
curl -fsS -X POST "$D/api/v1/triage/submit" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$ID" --argjson r "$TRIAGE" '{incidentId:$id, responses:$r}')" \
  | jq '{tier:.data.result.tier, predicted:.data.result.predictedServiceType, confidence:.data.result.confidence}'
echo "2) triage submitted"

RES=$(curl -fsS -X POST "$D/api/v1/dispatch/optimize" -H 'Content-Type: application/json' -d "{\"incidentId\":\"$ID\"}")
echo "3) dispatch (no client score sent):"
jq '{provider:.data.selectedProvider.name, type:.data.selectedProvider.type,
     trafficImpactScore:.data.metadata.trafficImpactScore,
     source:.data.metadata.trafficImpactSource,
     lambda:.data.metadata.lambda,
     trafficExternalityCost:.data.selectedProvider.costBreakdown.trafficExternalityCost}' <<<"$RES"

SRC=$(jq -r '.data.metadata.trafficImpactSource' <<<"$RES")
EXT=$(jq -r '.data.selectedProvider.costBreakdown.trafficExternalityCost' <<<"$RES")
if [ "$SRC" = "geo-intelligence" ] && awk "BEGIN{exit !($EXT > 0)}"; then
  echo "PASS: impact score sourced from geo-intelligence; externality cost $EXT > 0"
else
  echo "FAIL: source=$SRC externality=$EXT"; exit 1
fi
