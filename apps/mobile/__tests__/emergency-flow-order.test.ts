/**
 * The questionnaire is ordered by how much the trained tree leans on each
 * answer, because the driver can now bail at any step (see lib/emergencyFlow.ts).
 * That ordering is only worth anything if it stays true — reshuffle STEPS and
 * this fails.
 *
 * Reads the real exported tree rather than a copied-in table, so retraining the
 * model surfaces here instead of silently invalidating the order.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowSteps, type FlowState, type StepRoute } from "../lib/emergencyFlow";

const TREE = join(__dirname, "../../../components/dispatch/ml/exported_tree_tier1.json");

interface Node {
  feature?: string | null;
  samples: number;
  left?: Node;
  right?: Node;
}

/** Sample-weighted share of split decisions per question. */
function routingShare(): Record<string, number> {
  const tree = JSON.parse(readFileSync(TREE, "utf8")) as { root: Node };
  const weight: Record<string, number> = {};
  (function walk(n: Node) {
    if (!n?.feature) return;
    const q = n.feature.split("=")[0];
    weight[q] = (weight[q] ?? 0) + n.samples;
    if (n.left) walk(n.left);
    if (n.right) walk(n.right);
  })(tree.root);
  const total = Object.values(weight).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weight).map(([q, w]) => [q, (100 * w) / total]));
}

/** Which backend question each screen collects. `whats-wrong` asks Q1 directly. */
const ROUTE_TO_QUESTION: Record<StepRoute, string> = {
  "whats-wrong":      "Q1_intent",
  "engine-state":     "Q2_engine_start",
  "running-issue":    "Q2b_running_issue",
  "diagnosis-lights": "Q5_lights",
  recent:             "Q9_recent",
  "diagnosis-sound":  "Q3_sound",
  electrical:         "Q3b_electrical",
  "overheat-detail":  "Q7_overheat_detail",
  "noise-detail":     "Q4_noise_detail",
  "smoke-color":      "Q8_smoke_color",
  "brake-detail":     "Q_brake_detail",
  "gear-detail":      "Q_gear_detail",
  smells:             "Q6_smells",
  context:            "location_type",
};

/** The most common full path: engine trouble, car runs but makes a noise. */
const COMMON_PATH: FlowState = {
  q1Intent: "ENGINE_PROBLEM",
  engineState: "STARTS_NORMAL",
  runningIssue: "NOISE",
};

describe("emergency questionnaire order", () => {
  const share = routingShare();
  const path = flowSteps(COMMON_PATH).map((s) => ROUTE_TO_QUESTION[s.route]);

  it("asks every high-signal question (>=10% routing share) within the first 5 steps", () => {
    const heavy = Object.entries(share)
      .filter(([, pct]) => pct >= 10)
      .map(([q]) => q);

    expect(heavy.length).toBeGreaterThan(0);
    for (const q of heavy) {
      const at = path.indexOf(q);
      expect(at, `${q} (${share[q].toFixed(1)}%) must be asked early`).toBeGreaterThanOrEqual(0);
      expect(at, `${q} (${share[q].toFixed(1)}%) is at step ${at + 1}`).toBeLessThan(5);
    }
  });

  it("captures at least 75% of routing signal in the first 5 steps", () => {
    const captured = path.slice(0, 5).reduce((sum, q) => sum + (share[q] ?? 0), 0);
    expect(captured).toBeGreaterThanOrEqual(75);
  });

  it("puts questions the tree never splits on behind the ones it does", () => {
    // Q4_noise_detail and Q8_smoke_color are in feature_names but appear in no
    // split, in either tier. They must not sit in front of a question that counts.
    const dead = path.filter((q) => !(q in share));
    expect(dead.length, "expected at least one never-split question on this path").toBeGreaterThan(0);

    const lastScoring = Math.max(...path.map((q, i) => (share[q] >= 10 ? i : -1)));
    for (const q of dead) {
      expect(path.indexOf(q), `${q} is never split on and must come last`).toBeGreaterThan(lastScoring);
    }
  });

  it("never asks a question the driver's answers ruled out", () => {
    // Brake path must not collect engine questions, and vice versa.
    const brake = flowSteps({ q1Intent: "BRAKE_ISSUE", engineState: null, runningIssue: null })
      .map((s) => s.route);
    expect(brake).toContain("brake-detail");
    expect(brake).not.toContain("engine-state");
    expect(brake).not.toContain("gear-detail");
    expect(brake).not.toContain("running-issue");

    // Unconditional questions survive on every path.
    expect(brake).toContain("diagnosis-lights");
    expect(brake).toContain("recent");
    expect(brake).toContain("smells");
    expect(brake).toContain("context");
  });
});
