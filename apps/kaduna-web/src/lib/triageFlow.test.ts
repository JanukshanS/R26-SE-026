// Run: node --test src/lib/triageFlow.test.ts   (Node 22 strips the types)
//
// Guards the two things a data port can silently get wrong: which questions a
// given driver is asked, and whether an answer from a branch they backed out of
// still reaches the payload. Mirrors apps/mobile/__tests__/emergency-flow-order.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answer,
  buildTriageResponses,
  EMPTY_ANSWERS,
  flowSteps,
  toggle,
  type Answers,
} from "./triageFlow.ts";

const keys = (a: Answers) => flowSteps(a).map((s) => s.key);

test("the common engine path asks the heavy questions first", () => {
  let a = answer(EMPTY_ANSWERS, "Q1_intent", "ENGINE_PROBLEM");
  a = answer(a, "Q2_engine_start", "STARTS_NORMAL");
  a = answer(a, "Q2b_running_issue", "NOISE");

  assert.deepEqual(keys(a), [
    "Q1_intent",
    "Q2_engine_start",
    "Q5_lights",
    "Q9_recent",
    "Q6_smells",
    "Q2b_running_issue",
    "Q4_noise_detail",
    "context",
  ]);
});

test("a branch never collects the other branch's questions", () => {
  const brake = keys(answer(EMPTY_ANSWERS, "Q1_intent", "BRAKE_ISSUE"));
  assert.ok(brake.includes("Q_brake_detail"));
  assert.ok(!brake.includes("Q2_engine_start"));
  assert.ok(!brake.includes("Q_gear_detail"));
  assert.ok(!brake.includes("Q2b_running_issue"));
  // The unconditional tail survives on every path.
  for (const k of ["Q5_lights", "Q9_recent", "Q6_smells", "context"]) {
    assert.ok(brake.includes(k as never), `${k} must always be asked`);
  }
});

test("backing out of a branch clears the answer it collected", () => {
  let a = answer(EMPTY_ANSWERS, "Q1_intent", "WONT_START");
  a = answer(a, "Q2_engine_start", "NO_CRANK");
  a = answer(a, "Q3b_electrical", "DIM_LIGHTS");
  assert.equal(buildTriageResponses(a).Q3b_electrical, "DIM_LIGHTS");

  // Same driver goes back and says the engine actually starts.
  a = answer(a, "Q2_engine_start", "STARTS_NORMAL");
  assert.equal(buildTriageResponses(a).Q3b_electrical, "NOT_ASKED");
  assert.ok(!keys(a).includes("Q3b_electrical"));

  // And changing Q1 wipes the engine subtree entirely.
  a = answer(a, "Q1_intent", "GEAR_ISSUE");
  assert.equal(buildTriageResponses(a).Q2_engine_start, "NOT_ASKED");
});

test("a fast intent skips the questionnaire and submits the asserted defaults", () => {
  const a = answer(EMPTY_ANSWERS, "Q1_intent", "FLAT_TIRE");
  assert.deepEqual(keys(a), ["Q1_intent"]);
  // Byte-for-byte mobile's buildFastPathDefaults() in quick-dispatch.tsx.
  assert.deepEqual(buildTriageResponses(a), {
    Q1_intent: "FLAT_TIRE",
    Q2_engine_start: "NOT_ASKED",
    Q2b_running_issue: "NOT_ASKED",
    Q3_sound: "NOT_ASKED",
    Q3b_electrical: "NOT_ASKED",
    Q4_noise_detail: "NOT_ASKED",
    Q7_overheat_detail: "NOT_ASKED",
    Q8_smoke_color: "NOT_ASKED",
    Q_brake_detail: "NOT_ASKED",
    Q_gear_detail: "NOT_ASKED",
    Q6_smells: "NO_SMELL",
    Q5_lights: ["NONE"],
    Q9_recent: ["NO_SIGNS"],
    location_type: "URBAN",
    recent_rain: "NONE",
    parked_overnight: "OUTDOOR",
    vehicle_age_bucket: "8_15",
    last_fueled: "WITHIN_WEEK",
  });
});

test("lamp tiles map onto backend enums, and Fuel/Other collapse to one SERVICE", () => {
  const a: Answers = { ...EMPTY_ANSWERS, Q5_lights: ["battery", "fuel", "other"] };
  assert.deepEqual(buildTriageResponses(a).Q5_lights, ["BATTERY", "SERVICE"]);
});

test("NO_SIGNS is exclusive with the other warning signs", () => {
  assert.deepEqual(toggle(["HARD_START"], "NO_SIGNS"), ["NO_SIGNS"]);
  assert.deepEqual(toggle(["NO_SIGNS"], "HARD_START"), ["HARD_START"]);
  assert.deepEqual(toggle(["NO_SIGNS"], "NO_SIGNS"), []);
});
