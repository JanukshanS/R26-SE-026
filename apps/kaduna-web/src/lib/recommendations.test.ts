import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COVERED_KM,
  buildRecommendations,
  haversineKm,
  recommendationText,
  unitForIncident,
  type IncidentPoint,
  type ProviderPoint,
} from "./recommendations.ts";
import type { HotspotCluster } from "./types.ts";

function hotspot(over: Partial<HotspotCluster> = {}): HotspotCluster {
  return {
    id: 1, lat: 6.9271, lng: 79.8612, count: 10, avgScore: 6,
    risk: 30, roadType: "primary", incidentType: "engine_failure",
    peakHour: 18, radiusM: 400, ...over,
  };
}
const provider = (o: Partial<ProviderPoint> = {}): ProviderPoint => ({
  id: "p1", name: "Unit", type: "MOBILE_MECHANIC",
  latitude: 6.9271, longitude: 79.8612, ...o,
});
const incident = (o: Partial<IncidentPoint> = {}): IncidentPoint => ({
  lat: 6.9271, lng: 79.8612, vhl: 20, recoveryMin: 60, ...o,
});

test("haversine matches a known Colombo distance", () => {
  // Fort to Nugegoda is about 8 km.
  const km = haversineKm(6.9344, 79.8428, 6.8649, 79.8997);
  assert.ok(km > 7 && km < 11, `got ${km}`);
});

test("incident type picks the unit that clears it", () => {
  assert.equal(unitForIncident("accident_major"), "TOW_HEAVY");
  assert.equal(unitForIncident("fuel_empty"), "FUEL_DELIVERY");
  // Anything unmapped falls to the widest capability set rather than dropping out.
  assert.equal(unitForIncident("something_new"), "MOBILE_MECHANIC");
});

test("a cluster already covered saves nothing", () => {
  const [r] = buildRecommendations([hotspot()], [provider()], [incident()]);
  assert.equal(r.covered, true);
  assert.ok(r.nearestKm !== null && r.nearestKm < 0.1);
  assert.equal(r.minutesSaved, 0);
  assert.equal(r.vhlSaved, 0);
});

test("a cluster past the cap saves the capped travel time", () => {
  const far = provider({ latitude: 7.4, longitude: 80.4 });
  const [r] = buildRecommendations([hotspot()], [far], [incident()]);
  assert.equal(r.covered, false);
  // 10 km at 25 km/h is 24 minutes, which is 40% of a 60-minute recovery.
  assert.equal(r.minutesSaved, 24);
  assert.equal(r.matchedIncidents, 1);
  assert.equal(r.vhlSaved, 8);
});

test("no capable unit anywhere is treated as a total gap, not skipped", () => {
  // Only a locksmith exists; the cluster needs a mechanic.
  const [r] = buildRecommendations(
    [hotspot()], [provider({ type: "LOCKSMITH" })], [incident()]
  );
  assert.equal(r.nearestKm, null);
  assert.equal(r.vhlSaved, 8);
  assert.match(recommendationText(r), /No mobile mechanic is registered anywhere\./);
});

test("time saved never sheds more than the whole incident", () => {
  const far = provider({ latitude: 7.4, longitude: 80.4 });
  // Clears in 10 minutes, so arriving 24 minutes sooner still only avoids the
  // one incident's worth of delay.
  const [r] = buildRecommendations([hotspot()], [far], [incident({ recoveryMin: 10 })]);
  assert.equal(r.vhlSaved, 20);
});

test("a cluster with no incident inside its radius falls back to the average", () => {
  const far = provider({ latitude: 7.4, longitude: 80.4 });
  const [r] = buildRecommendations(
    [hotspot({ count: 12, lat: 7.2, lng: 80.2 })], [far], [incident()]
  );
  assert.equal(r.matchedIncidents, 0);
  assert.equal(r.vhlSaved, 96);
});

test("busier and worse-served clusters rank first", () => {
  const near = provider({ latitude: 6.9271, longitude: 79.8612 });
  const out = buildRecommendations(
    [
      hotspot({ id: 1, count: 40, avgScore: 8 }),                       // busy, covered
      hotspot({ id: 2, count: 12, avgScore: 7, lat: 7.2, lng: 80.2 }),  // smaller, far
    ],
    [near],
    [incident()]
  );
  assert.equal(out[0].hotspotId, 2, "the unserved cluster should lead");
  assert.ok(out[0].vhlSaved > out[1].vhlSaved);
});

test("distance stops adding priority past the cap", () => {
  const inc = [incident()];
  const at12 = buildRecommendations([hotspot()], [provider({ latitude: 7.035 })], inc);
  const at40 = buildRecommendations([hotspot()], [provider({ latitude: 7.29 })], inc);
  assert.equal(at12[0].vhlSaved, at40[0].vhlSaved);
});

test("the sentence names the unit, the hour, the cover and the saving", () => {
  const [r] = buildRecommendations(
    [hotspot({ peakHour: 8 })], [provider({ latitude: 6.99 })], [incident()]
  );
  const text = recommendationText(r);
  assert.match(text, /Station a mobile mechanic/);
  assert.match(text, /covering 08:00/);
  assert.match(text, /Nearest mobile mechanic is \d+\.\d km away\./);
  assert.match(text, /Arriving \d+ min sooner would avoid about \d+(\.\d)? vehicle-hours/);
});

test("COVERED_KM is the stated threshold, not an arbitrary one", () => {
  assert.equal(COVERED_KM, 5);
});
