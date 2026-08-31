import type { HotspotCluster } from "./types";

/**
 * Where to station a unit, derived from the mined hotspots.
 *
 * The supervisor's note on 29 August was that showing where incidents cluster
 * is not the contribution — recommending what to do about it is. This turns the
 * 25 clusters into a ranked list of placements, each with a unit type, a time
 * window, and the distance to the nearest unit that could already cover it.
 *
 * Clusters are ranked by the vehicle-hours of delay a unit stationed there
 * would avoid, which is the unit the rest of the dashboard already reports.
 * The earlier ranking multiplied incident count by average impact by distance
 * and produced a bare index — a number that ordered the list correctly but
 * meant nothing on its own, so nobody could say what a placement was worth.
 */

export interface ProviderPoint {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
}

/** The fields of a scored incident this ranking needs. `Incident` satisfies it. */
export interface IncidentPoint {
  lat: number;
  lng: number;
  vhl: number;
  recoveryMin: number;
}

export interface Recommendation {
  hotspotId: number;
  lat: number;
  lng: number;
  radiusM: number;
  /** Incidents in the cluster, as mined. */
  incidents: number;
  avgScore: number;
  /** Local hour the cluster peaks, 0-23. */
  peakHour: number;
  roadType: string;
  incidentType: string;
  /** Provider type that clears this cluster's dominant incident. */
  unitType: string;
  /** Distance to the nearest unit of that type, km. Null when none exist. */
  nearestKm: number | null;
  nearestName: string | null;
  /** Scored incidents that fall inside the drawn cluster radius. */
  matchedIncidents: number;
  /** How much sooner a unit stationed here would arrive, minutes. */
  minutesSaved: number;
  /** Vehicle-hours of delay that earlier arrival would avoid. */
  vhlSaved: number;
  covered: boolean;
}

/** A cluster whose nearest capable unit is beyond this is treated as uncovered. */
export const COVERED_KM = 5;
/** Distance past which a unit is treated as absent rather than merely far. */
const DISTANCE_CAP_KM = 10;
/**
 * Colombo urban average. The same number dispatch uses for its own ETA
 * (`AVG_SPEED_KMH` in dispatch-optimizer.ts) — two different response-time
 * assumptions in one platform is a contradiction waiting to be found.
 */
const RESPONSE_KMH = 25;
/** Floor on the cluster radius, matching the circle the map draws. */
const MIN_RADIUS_M = 300;

const EARTH_KM = 6371;

export function haversineKm(
  aLat: number, aLng: number, bLat: number, bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(s));
}

/**
 * Which kind of unit clears which incident. A major accident needs heavy
 * recovery; a flat battery needs a mechanic. Anything unrecognised falls to a
 * mechanic, who carries the widest capability set.
 */
export const UNIT_FOR_INCIDENT: Record<string, string> = {
  accident_major: "TOW_HEAVY",
  major_accident: "TOW_HEAVY",
  accident_minor: "TOW_LIGHT",
  minor_accident: "TOW_LIGHT",
  engine_failure: "MOBILE_MECHANIC",
  overheating: "MOBILE_MECHANIC",
  flat_tire: "MOBILE_MECHANIC",
  battery_dead: "MOBILE_MECHANIC",
  fuel_empty: "FUEL_DELIVERY",
  lockout: "LOCKSMITH",
};

export const UNIT_LABEL: Record<string, string> = {
  TOW_HEAVY: "Heavy recovery",
  TOW_LIGHT: "Light tow",
  MOBILE_MECHANIC: "Mobile mechanic",
  FUEL_DELIVERY: "Fuel delivery",
  LOCKSMITH: "Locksmith",
};

export function unitForIncident(incidentType: string): string {
  return UNIT_FOR_INCIDENT[incidentType] ?? "MOBILE_MECHANIC";
}

/**
 * Rank the clusters by the delay a placement would avoid.
 *
 * A unit stationed on the cluster arrives `nearestKm / 25 km/h` sooner than the
 * nearest capable unit does today. An incident that is cleared that much sooner
 * blocks the road for that much less of its recovery time, so it sheds the same
 * share of the vehicle-hours it was going to cost.
 *
 * The share is taken as linear in the time saved. Deterministic queueing makes
 * the real relationship steeper than linear, because the queue is still growing
 * while the incident stands, so this understates the benefit rather than
 * inflating it.
 */
export function buildRecommendations(
  hotspots: HotspotCluster[],
  providers: ProviderPoint[],
  incidents: IncidentPoint[] = []
): Recommendation[] {
  const meanVhl = incidents.length
    ? incidents.reduce((s, i) => s + i.vhl, 0) / incidents.length
    : 0;
  const meanRecovery = incidents.length
    ? incidents.reduce((s, i) => s + i.recoveryMin, 0) / incidents.length
    : 0;

  return hotspots
    .map((h) => {
      const unitType = unitForIncident(h.incidentType);
      const capable = providers.filter((p) => p.type === unitType);

      let nearestKm: number | null = null;
      let nearestName: string | null = null;
      for (const p of capable) {
        const km = haversineKm(h.lat, h.lng, p.latitude, p.longitude);
        if (nearestKm === null || km < nearestKm) {
          nearestKm = km;
          nearestName = p.name;
        }
      }

      // With no capable unit anywhere the gap is total, so the saving takes the
      // value it would have at the cap rather than dropping out of the ranking.
      const gapKm = nearestKm === null ? DISTANCE_CAP_KM : Math.min(nearestKm, DISTANCE_CAP_KM);
      const minutesSaved = (gapKm / RESPONSE_KMH) * 60;

      const radiusM = Math.max(h.radiusM, MIN_RADIUS_M);
      const inCluster = incidents.filter(
        (i) => haversineKm(h.lat, h.lng, i.lat, i.lng) * 1000 <= radiusM
      );

      const share = (recoveryMin: number) =>
        recoveryMin > 0 ? Math.min(minutesSaved / recoveryMin, 1) : 1;

      // DBSCAN clusters are not circles, so a few have no scored incident
      // inside the radius the map draws. Those fall back to the dataset average
      // rather than reading as a cluster worth nothing.
      const vhlSaved = inCluster.length
        ? inCluster.reduce((s, i) => s + i.vhl * share(i.recoveryMin), 0)
        : h.count * meanVhl * share(meanRecovery);

      return {
        hotspotId: h.id,
        lat: h.lat,
        lng: h.lng,
        radiusM,
        incidents: h.count,
        avgScore: h.avgScore,
        peakHour: h.peakHour,
        roadType: h.roadType,
        incidentType: h.incidentType,
        unitType,
        nearestKm,
        nearestName,
        matchedIncidents: inCluster.length,
        minutesSaved: Math.round(minutesSaved),
        vhlSaved: Math.round(vhlSaved * 10) / 10,
        covered: nearestKm !== null && nearestKm <= COVERED_KM,
      };
    })
    .sort((a, b) => b.vhlSaved - a.vhlSaved);
}

/** The recommendation as a sentence, which is what a report needs. */
export function recommendationText(r: Recommendation): string {
  const unit = (UNIT_LABEL[r.unitType] ?? r.unitType).toLowerCase();
  const window = `${String(r.peakHour).padStart(2, "0")}:00`;
  const cover =
    r.nearestKm === null
      ? `No ${unit} is registered anywhere.`
      : `Nearest ${unit} is ${r.nearestKm.toFixed(1)} km away.`;
  const n = r.matchedIncidents || r.incidents;
  return (
    `Station a ${unit} near this cluster, covering ${window}. ${cover} ` +
    `Arriving ${r.minutesSaved} min sooner would avoid about ${r.vhlSaved} ` +
    `vehicle-hours of delay across the ${n} incidents recorded here.`
  );
}
