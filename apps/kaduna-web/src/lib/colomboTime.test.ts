import assert from "node:assert/strict";
import { test } from "node:test";

import { colomboTime } from "./colomboTime.ts";

test("just after Colombo midnight the date is already tomorrow, though UTC is not", () => {
  // 00:30 Friday 9 Oct in Colombo is 19:00 Thursday 8 Oct in UTC.
  const at = new Date("2026-10-08T19:00:00Z");
  assert.equal(at.toISOString().slice(0, 10), "2026-10-08");
  assert.deepEqual(colomboTime(at), { hour: 0, dayOfWeek: 4, date: "2026-10-09" });
});

test("the last minute of the UTC lag still reads as the Colombo day", () => {
  assert.deepEqual(colomboTime(new Date("2026-10-08T23:59:00Z")), {
    hour: 5, dayOfWeek: 4, date: "2026-10-09",
  });
});

test("hour, weekday and date roll over together at Colombo midnight", () => {
  assert.deepEqual(colomboTime(new Date("2026-10-10T18:29:00Z")), {
    hour: 23, dayOfWeek: 5, date: "2026-10-10",
  });
  assert.deepEqual(colomboTime(new Date("2026-10-10T18:30:00Z")), {
    hour: 0, dayOfWeek: 6, date: "2026-10-11",
  });
});
