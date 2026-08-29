import type { Incident } from "./types";

/**
 * What the map is currently showing.
 *
 * The same predicate has to run in three places — the count in the toolbar and
 * each of the two map engines — and it had drifted into three copies. One
 * definition means a new filter is added once rather than three times, and the
 * number beside the map cannot disagree with the markers on it.
 */
export interface MapFilters {
  priority: string[];
  roadType: string;
  /** Hour of day, 0–23. */
  hour: number | null;
  /** Day of week, 0 = Monday. */
  day: number | null;
}

export const NO_FILTERS: MapFilters = {
  priority: [],
  roadType: "all",
  hour: null,
  day: null,
};

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function matchesFilters(inc: Incident, f: MapFilters): boolean {
  if (f.priority.length > 0 && !f.priority.includes(inc.priority)) return false;
  if (f.roadType && f.roadType !== "all" && inc.roadType !== f.roadType) return false;
  if (f.hour !== null && inc.hour !== f.hour) return false;
  if (f.day !== null && inc.dayOfWeek !== f.day) return false;
  return true;
}

/** True when anything is narrowing the view, so a reset is worth offering. */
export function isFiltered(f: MapFilters): boolean {
  return f.priority.length > 0 || f.roadType !== "all" || f.hour !== null || f.day !== null;
}

/** Plain-language summary of the active filters, for the export filename and
 *  the reset control. */
export function describeFilters(f: MapFilters): string {
  const parts: string[] = [];
  if (f.priority.length > 0) parts.push(f.priority.map((p) => p.toLowerCase()).join("+"));
  if (f.roadType !== "all") parts.push(f.roadType);
  if (f.day !== null) parts.push(DAY_NAMES[f.day].toLowerCase());
  if (f.hour !== null) parts.push(`${String(f.hour).padStart(2, "0")}00`);
  return parts.join("-");
}
