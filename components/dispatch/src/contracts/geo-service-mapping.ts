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
