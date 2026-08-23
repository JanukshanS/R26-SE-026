// Vendored copy of /contracts/geo-service-mapping.ts.
//
// The canonical file lives in contracts/ but sits outside this service's
// tsconfig rootDir and outside its Docker build context, so importing it
// across that boundary breaks both `npm run build` and the image build.
// apps/dashboard-web keeps a local copy for the same reason. Keep in sync
// with the canonical file when the service-type mapping changes.

/**
 * Maps dispatch ServiceType (triage vocabulary) to geo-intelligence incident_type.
 * Must stay aligned with contracts/geo-intelligence.openapi.yaml ScoreRequest.incident_type.
 */
export const SERVICE_TO_INCIDENT_TYPE: Record<string, string> = {
  MAJOR_ACCIDENT: "major_accident",
  URGENT_TOW: "major_accident",
  SEVERE_MECHANICAL_TOW: "major_accident",
  FLOOD_RECOVERY: "major_accident",
  FLAT_TIRE_CHANGE: "flat_tire",
  FUEL_EMPTY: "fuel_empty",
  FUEL_WRONG: "fuel_empty",
  LOCKOUT: "lockout",
  KEY_LOST: "lockout",
  BATTERY_JUMP: "battery_dead",
  BATTERY_TERMINAL_CLEAN: "battery_dead",
  BATTERY_REPLACE: "battery_dead",
  COOLANT_LOW: "overheating",
  RADIATOR_FAN_ISSUE: "overheating",
  RADIATOR_HOSE_LEAK: "overheating",
  ENGINE_OVERHEAT_SEVERE: "overheating",
};

export function mapServiceTypeToIncidentType(serviceType: string | undefined): string {
  if (!serviceType) return "engine_failure";
  return SERVICE_TO_INCIDENT_TYPE[serviceType] ?? "engine_failure";
}

/**
 * Lanes blocked by the stopped vehicle, keyed by dispatch ServiceType, for the
 * 2-lane default road geometry callers send to geo-intelligence. This drives the
 * capacity-loss factor, so a fixed value would pin a quarter of the score weight
 * to a constant and make the CRITICAL band unreachable.
 *   2 — scene needs recovery equipment or emergency response; carriageway closed.
 *   1 — default: one immobilised vehicle occupying its own lane.
 * The floor is 1, not 0: the default geometry models no shoulder, so even a secured
 * vehicle sits in a running lane. 0 is also outside what the model can represent —
 * score_with_uncertainty clips its lane draws to >= 1, so a 0 would return a
 * confidence band that excludes its own point score.
 */
export const SERVICE_TO_LANES_BLOCKED: Record<string, number> = {
  MAJOR_ACCIDENT: 2,
  URGENT_TOW: 2,
  SEVERE_MECHANICAL_TOW: 2,
  FLOOD_RECOVERY: 2,
};

export function mapServiceTypeToLanesBlocked(serviceType: string | undefined): number {
  if (!serviceType) return 1;
  return SERVICE_TO_LANES_BLOCKED[serviceType] ?? 1;
}
