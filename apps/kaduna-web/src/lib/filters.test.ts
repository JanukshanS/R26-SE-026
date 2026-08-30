import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_FILTERS, describeFilters, isFiltered, matchesFilters, type MapFilters } from "./filters.ts";
import { incidentsToCsv } from "./exportCsv.ts";
import type { Incident } from "./types.ts";

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: "INC-0001",
    lat: 6.9271,
    lng: 79.8612,
    roadType: "trunk",
    roadName: "Galle Road",
    totalLanes: 2,
    lanesBlocked: 1,
    incidentType: "accident_major",
    hour: 8,
    dayOfWeek: 0,
    dayName: "Monday",
    impactScore: 7.5,
    priority: "HIGH",
    queueKm: 5.6,
    vhl: 126.6,
    recoveryMin: 22.5,
    clf: 0.5,
    tvf: 0.9,
    tf: 1,
    lf: 0.85,
    isf: 0.5,
    ...over,
  };
}

const filters = (over: Partial<MapFilters> = {}): MapFilters => ({ ...NO_FILTERS, ...over });

test("no filters matches everything", () => {
  assert.equal(matchesFilters(incident(), NO_FILTERS), true);
  assert.equal(isFiltered(NO_FILTERS), false);
});

test("priority filter keeps only the selected bands", () => {
  assert.equal(matchesFilters(incident({ priority: "HIGH" }), filters({ priority: ["HIGH"] })), true);
  assert.equal(matchesFilters(incident({ priority: "LOW" }), filters({ priority: ["HIGH"] })), false);
});

test("road type filter ignores the 'all' sentinel", () => {
  assert.equal(matchesFilters(incident({ roadType: "trunk" }), filters({ roadType: "all" })), true);
  assert.equal(matchesFilters(incident({ roadType: "trunk" }), filters({ roadType: "primary" })), false);
});

test("hour and day filter independently", () => {
  const inc = incident({ hour: 8, dayOfWeek: 0 });
  assert.equal(matchesFilters(inc, filters({ hour: 8 })), true);
  assert.equal(matchesFilters(inc, filters({ hour: 9 })), false);
  assert.equal(matchesFilters(inc, filters({ day: 0 })), true);
  assert.equal(matchesFilters(inc, filters({ day: 4 })), false);
});

test("hour 0 and day 0 are filters, not absent ones", () => {
  // Guards the null-vs-falsy trap: Monday is 0 and midnight is 0, so a truthy
  // check here would silently ignore both.
  assert.equal(isFiltered(filters({ hour: 0 })), true);
  assert.equal(isFiltered(filters({ day: 0 })), true);
  assert.equal(matchesFilters(incident({ hour: 5 }), filters({ hour: 0 })), false);
});

test("filters combine as AND", () => {
  const inc = incident({ priority: "HIGH", roadType: "trunk", hour: 8, dayOfWeek: 0 });
  assert.equal(
    matchesFilters(inc, filters({ priority: ["HIGH"], roadType: "trunk", hour: 8, day: 0 })),
    true
  );
  assert.equal(
    matchesFilters(inc, filters({ priority: ["HIGH"], roadType: "trunk", hour: 8, day: 1 })),
    false
  );
});

test("describeFilters names the active narrowing for the filename", () => {
  assert.equal(describeFilters(NO_FILTERS), "");
  assert.equal(
    describeFilters(filters({ priority: ["HIGH"], roadType: "trunk", day: 0, hour: 8 })),
    "high-trunk-monday-0800"
  );
});

test("csv quotes cells containing a comma", () => {
  const csv = incidentsToCsv([incident({ roadName: "Galle Road, Kollupitiya" })]);
  const [header, row] = csv.split("\n");
  assert.equal(header.split(",")[0], "id");
  assert.ok(row.includes('"Galle Road, Kollupitiya"'), row);
  // The quoted cell must not add fields: 21 columns means 20 unquoted commas.
  assert.equal(header.split(",").length, 21);
});

test("csv escapes embedded quotes by doubling them", () => {
  const csv = incidentsToCsv([incident({ roadName: 'The "New" Road' })]);
  assert.ok(csv.includes('"The ""New"" Road"'), csv);
});

test("csv marks live incidents apart from the scored dataset", () => {
  const csv = incidentsToCsv([incident(), incident({ id: "LIVE-1", live: true })]);
  const rows = csv.split("\n");
  assert.ok(rows[1].endsWith("scored dataset"));
  assert.ok(rows[2].endsWith("live"));
});
