import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { calculateImpactScore } from "./scoring.ts";
import type { WhatIfInput } from "./types.ts";

interface ParityCase {
  input: WhatIfInput;
  expected: { score: number; priority: string; queueKm: number; vhl: number; recoveryMin: number };
}

// Produced by scripts/gen_scoring_fixture.py from the deployed Python model.
const cases: ParityCase[] = JSON.parse(
  readFileSync(new URL("./__fixtures__/scoring-parity.json", import.meta.url), "utf8")
);

test("the fixture is big enough to mean something", () => {
  assert.ok(cases.length >= 50, `only ${cases.length} cases`);
});

test("the browser model matches the deployed Python model", () => {
  for (const { input, expected } of cases) {
    const got = calculateImpactScore(input);
    const at = JSON.stringify(input);
    assert.ok(Math.abs(got.score - expected.score) <= 0.05, `score ${got.score} vs ${expected.score} at ${at}`);
    assert.equal(got.priority, expected.priority, `band at ${at}`);
    assert.ok(Math.abs(got.queueKm - expected.queueKm) <= 0.05, `queue at ${at}`);
    assert.ok(Math.abs(got.vhl - expected.vhl) <= 0.05, `vhl at ${at}`);
    assert.ok(Math.abs(got.recoveryMin - expected.recoveryMin) <= 0.05, `recovery at ${at}`);
  }
});

test("a weekday peak recovers in half the clearance time instead of saturating", () => {
  const r = calculateImpactScore({
    roadType: "primary", totalLanes: 2, lanesBlocked: 1,
    incidentType: "accident_major", hour: 8, dayOfWeek: 0,
  });
  assert.equal(r.recoveryMin, 60);
});
