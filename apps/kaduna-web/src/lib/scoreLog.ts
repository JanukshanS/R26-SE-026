import type { Incident } from "./types";

/**
 * A record of every score this dashboard requested for a live dispatch
 * incident, so a scored decision can be opened and read back afterwards.
 *
 * It is the dashboard's own call log, not dispatch's audit trail. Dispatch does
 * persist the score it used (`DispatchDecision.trafficImpactScore`), but no API
 * exposes those rows yet; until one does, this is the honest version — and it
 * is labelled that way in the UI rather than implying more provenance than it
 * has.
 *
 * Session-scoped and capped: this is a reading aid, not storage.
 */
export interface ScoreLogEntry {
  /** Unique per call, so repeated scores of one incident are separate rows. */
  key: string;
  /**
   * When dispatch recorded the incident, not when this dashboard got round to
   * scoring it. The two are unrelated: the poll scores everything outstanding
   * on page load, so stamping the clock here made every row read as the
   * moment the tab was opened.
   */
  at: Date;
  incident: Incident;
  /** How geo established the road: osm | request | default. */
  roadSource: string;
}

const MAX_ENTRIES = 200;

let entries: ScoreLogEntry[] = [];
const listeners = new Set<(e: ScoreLogEntry[]) => void>();

export function recordScore(incident: Incident, roadSource: string, at: Date): void {
  // One row per incident per hour: the live poll re-scores every 5s and an
  // unchanged score is not a new event.
  const key = `${incident.id}:${incident.hour}`;
  if (entries.some((e) => e.key === key)) return;

  entries = [{ key, at, incident, roadSource }, ...entries].slice(0, MAX_ENTRIES);
  listeners.forEach((fn) => fn(entries));
}

export function getScoreLog(): ScoreLogEntry[] {
  return entries;
}

export function subscribeScoreLog(fn: (e: ScoreLogEntry[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
