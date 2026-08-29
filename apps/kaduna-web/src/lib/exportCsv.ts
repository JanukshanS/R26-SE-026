import type { Incident } from "./types";

/**
 * Download whatever the map is currently showing as a CSV.
 *
 * One row per incident with every scored field, rather than a rendered summary:
 * a road authority asking for "the report" wants the numbers in a spreadsheet,
 * and any summary they need can be built from these columns. Exporting the
 * filtered set rather than all 500 means the file matches the screen it was
 * taken from.
 */

const COLUMNS = [
  ["id", (i: Incident) => i.id],
  ["priority", (i: Incident) => i.priority],
  ["impact_score", (i: Incident) => i.impactScore],
  ["road_name", (i: Incident) => i.roadName],
  ["road_type", (i: Incident) => i.roadType],
  ["lanes_blocked", (i: Incident) => i.lanesBlocked],
  ["total_lanes", (i: Incident) => i.totalLanes],
  ["incident_type", (i: Incident) => i.incidentType],
  ["day", (i: Incident) => i.dayName],
  ["hour", (i: Incident) => i.hour],
  ["queue_km", (i: Incident) => i.queueKm],
  ["vehicle_hours_lost", (i: Incident) => i.vhl],
  ["recovery_min", (i: Incident) => i.recoveryMin],
  ["capacity_loss_factor", (i: Incident) => i.clf],
  ["traffic_volume_factor", (i: Incident) => i.tvf],
  ["temporal_factor", (i: Incident) => i.tf],
  ["location_factor", (i: Incident) => i.lf],
  ["incident_severity_factor", (i: Incident) => i.isf],
  ["latitude", (i: Incident) => i.lat],
  ["longitude", (i: Incident) => i.lng],
  ["source", (i: Incident) => (i.live ? "live" : "scored dataset")],
] as const;

/** Quote anything that could break a cell. Road names carry commas. */
function cell(value: string | number | undefined): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function incidentsToCsv(incidents: Incident[]): string {
  const header = COLUMNS.map(([name]) => name).join(",");
  const rows = incidents.map((inc) => COLUMNS.map(([, get]) => cell(get(inc))).join(","));
  return [header, ...rows].join("\n");
}

/** `suffix` describes the active filters; the caller builds it so this module
 *  imports nothing but types and stays testable outside the framework. */
export function downloadIncidentsCsv(incidents: Incident[], suffix: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = ["kaduna-incidents", suffix, stamp].filter(Boolean).join("-");

  const blob = new Blob([incidentsToCsv(incidents)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
