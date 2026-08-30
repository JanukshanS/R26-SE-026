import type { HotspotCluster } from "./types";

/**
 * Where to station a unit, derived from the mined hotspots.
 *
 * The supervisor's note on 29 August was that showing where incidents cluster
 * is not the contribution — recommending what to do about it is. This turns the
 * 25 clusters into a ranked list of placements, each with a unit type, a time
 * window, and the distance to the nearest unit that could already cover it.
 *
 * The ranking is deliberately one line of arithmetic rather than a model. A
 * road authority has to be able to ask why a location is first and get an
 * answer in a sentence, which is the same reason the impact score is a weighted
 * sum and not a neural network.
 */

export interface ProviderPoint {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
}

export interface Recommendation {
  hotspotId: number;
  lat: number;
  lng: number;
  /** Incidents in the cluster. */
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
  /** incidents x average impact — how much disruption the cluster produces. */
  demand: number;
  /** demand weighted by how far help currently is. */
  priority: number;
  covered: boolean;
}

/** A cluster whose nearest capable unit is beyond this is treated as uncovered. */
export const COVERED_KM = 5;
/** Distance past which extra remoteness stops increasing priority. */
const DISTANCE_CAP_KM = 10;

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
 * Rank the clusters by where a unit would do the most good.
 *
 * priority = incidents x average impact x (km to nearest capable unit, capped
 * at 10, over 10)
 *
 * The first two terms are how much disruption the cluster produces; the third
 * is how poorly it is served today. A busy cluster with a unit already parked
 * on it scores near zero, which is correct — there is nothing to recommend.
 */
export function buildRecommendations(
  hotspots: HotspotCluster[],
  providers: ProviderPoint[]
): Recommendation[] {
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

      const demand = h.count * h.avgScore;
      // With no capable unit anywhere, the gap is total, so the distance term
      // takes its maximum rather than dropping the cluster from the list.
      const distanceTerm =
        nearestKm === null ? 1 : Math.min(nearestKm, DISTANCE_CAP_KM) / DISTANCE_CAP_KM;

      return {
        hotspotId: h.id,
        lat: h.lat,
        lng: h.lng,
        incidents: h.count,
        avgScore: h.avgScore,
        peakHour: h.peakHour,
        roadType: h.roadType,
        incidentType: h.incidentType,
        unitType,
        nearestKm,
        nearestName,
        demand: Math.round(demand * 10) / 10,
        priority: Math.round(demand * distanceTerm * 10) / 10,
        covered: nearestKm !== null && nearestKm <= COVERED_KM,
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

/** The recommendation as a sentence, which is what a report needs. */
export function recommendationText(r: Recommendation): string {
  const unit = (UNIT_LABEL[r.unitType] ?? r.unitType).toLowerCase();
  const window = `${String(r.peakHour).padStart(2, "0")}:00`;
  const cover =
    r.nearestKm === null
      ? `No ${unit} is registered anywhere.`
      : `Nearest ${unit} is ${r.nearestKm.toFixed(1)} km away.`;
  return `Station a ${unit} near this cluster, covering ${window}. ${cover}`;
}
