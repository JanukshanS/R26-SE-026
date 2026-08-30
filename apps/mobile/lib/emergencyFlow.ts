/**
 * The adaptive questionnaire's shape, in one place.
 *
 * Every question screen used to hardcode its own `router.push` to the next
 * one, which made two things impossible: telling the driver how far along they
 * are (13 screens all titled "Diagnosis Process", no counter anywhere), and
 * reordering the questions without hunting through 13 files.
 *
 * ── Why this order ──────────────────────────────────────────────────────
 * The screens are sequenced by how much the trained tree actually leans on
 * each answer, measured off components/dispatch/ml/exported_tree_tier1.json
 * (sample-weighted share of split decisions). Re-measured against the v3
 * real-data retrain (depth 19, 213 leaves), which reshuffled the weights:
 *
 *     Q5_lights          22.0%
 *     Q9_recent          15.1%
 *     Q2_engine_start    14.9%
 *     Q6_smells          10.8%   ← was 1.9% and asked last, pre-v3
 *     Q2b_running_issue   7.2%   ← was 29.0% and the root split, pre-v3
 *     Q3_sound            4.3%
 *     ...everything else  <4% each
 *
 * Since the driver can bail at any step (see SKIP below), question order
 * decides how much signal the model gets from someone who stops early. The
 * first five screens now carry 66.3% of the routing weight, which is the
 * ceiling: Q1 must be step one (it is the grid that picks the branch), so the
 * best any ordering can do is Q1 plus the four heaviest questions.
 *
 * The v3 retrain also dropped location_type and vehicle_age_bucket from the
 * feature set entirely — the `context` screen (location, rain, parked-overnight,
 * vehicle age, last-fueled) was removed accordingly (see git history), so
 * every driver now gets the same SL-context defaults the fast-path already
 * used (DEFAULT_SL_CONTEXT in emergencyContext.tsx), same as skipping ever did.
 *
 * Reordering is answer-preserving: Q5, Q9 and Q6 are asked unconditionally on
 * every path, so re-sequencing them cannot change WHICH questions a given
 * driver sees. Every conditional predicate below is unchanged, and
 * running-issue still follows engine-state, which sets the state it reads.
 *
 * ── SKIP ────────────────────────────────────────────────────────────────
 * Any step can be abandoned via "Send help now", which routes to
 * quick-dispatch and files whatever has been answered so far.
 * buildTriageResponses() already defaults every unanswered field, and
 * dispatch's validators carry no cross-field rules, so a partial payload is
 * valid on every branch. See 00-UX-MAP.md §4.1 for the one real caveat: the
 * eight enums that have no NOT_ASKED value and therefore get *asserted*
 * defaults rather than "unknown".
 */

/** The five ML intents — these enter the questionnaire. */
export type Q1MLIntent =
  | "WONT_START" | "ENGINE_PROBLEM" | "WEIRD_BEHAVIOR"
  | "BRAKE_ISSUE" | "GEAR_ISSUE";

/** Route slugs inside app/(emergency)/ that make up the questionnaire. */
export type StepRoute =
  | "whats-wrong"
  | "engine-state"
  | "running-issue"
  | "diagnosis-lights"
  | "recent"
  | "diagnosis-sound"
  | "electrical"
  | "overheat-detail"
  | "noise-detail"
  | "smoke-color"
  | "brake-detail"
  | "gear-detail"
  | "smells";

/** Just the answers that decide which steps are active. */
export interface FlowState {
  q1Intent:     Q1MLIntent | null;
  engineState:  string | null;
  runningIssue: string | null;
}

interface StepDef {
  route: StepRoute;
  /** Short topic heading. The question itself is the screen's `prompt`. */
  title: string;
  /** Active for this state? Omitted = always asked. */
  when?: (s: FlowState) => boolean;
}

/** Intents that lead into the engine subtree (Q2 → Q2b / Q3 / Q3b). */
const ENGINE_INTENTS: Q1MLIntent[] = ["WONT_START", "ENGINE_PROBLEM", "WEIRD_BEHAVIOR"];

/**
 * Ordered. Reordering this array reorders the questionnaire — nothing else
 * needs to change, and flow-order.test.ts will fail if the order stops
 * matching the tree's priority ranking.
 */
const STEPS: StepDef[] = [
  { route: "whats-wrong",      title: "What's wrong?" },
  // Q2 — 14.9%
  { route: "engine-state",     title: "Engine",
    when: (s) => s.q1Intent != null && ENGINE_INTENTS.includes(s.q1Intent) },
  // Q5 — 22.0%, the single heaviest question. Always asked.
  { route: "diagnosis-lights", title: "Warning lights" },
  // Q9 — 15.1%. Always asked.
  { route: "recent",           title: "Recent warning signs" },
  // Q6 — 10.8%. Always asked. The v3 retrain promoted this out of the tail.
  { route: "smells",           title: "Smell" },
  // Q2b — 7.2%. Was the root split pre-v3; now mid-weight, so it drops out of
  // the top five. Still ahead of every branch detail that reads runningIssue.
  { route: "running-issue",    title: "Running problem",
    when: (s) => s.engineState === "STARTS_NORMAL" || s.engineState === "STARTS_BUT_ISSUE" },
  // Branch detail — at most one of these is ever active.
  { route: "diagnosis-sound",  title: "Sound",
    when: (s) => s.engineState === "CRANKS_NO_START" },
  { route: "electrical",       title: "Lights and power",
    when: (s) => s.engineState === "NO_CRANK" },
  { route: "overheat-detail",  title: "Overheating",
    when: (s) => s.runningIssue === "OVERHEATING" },
  { route: "noise-detail",     title: "Noise",
    when: (s) => s.runningIssue === "NOISE" },
  { route: "smoke-color",      title: "Smoke",
    when: (s) => s.runningIssue === "SMOKE" },
  { route: "brake-detail",     title: "Brakes",
    when: (s) => s.q1Intent === "BRAKE_ISSUE" },
  { route: "gear-detail",      title: "Gears",
    when: (s) => s.q1Intent === "GEAR_ISSUE" },
];

/** The steps this driver will actually see, given what they've answered. */
export function flowSteps(s: FlowState): StepDef[] {
  return STEPS.filter((step) => !step.when || step.when(s));
}

/**
 * "Step 3 of 7" for the header. `total` is recomputed from current answers, so
 * it can tick up by one when a branch question opens a detail screen — that's
 * honest, and only ever moves by one.
 */
export function stepPosition(s: FlowState, route: StepRoute): { index: number; total: number } {
  const active = flowSteps(s);
  const i = active.findIndex((step) => step.route === route);
  return { index: i < 0 ? 1 : i + 1, total: active.length };
}

/** Where "Next" goes from here. `null` means this was the last question. */
export function nextRoute(s: FlowState, route: StepRoute): QuestionRoute | null {
  const active = flowSteps(s);
  const i = active.findIndex((step) => step.route === route);
  if (i < 0 || i === active.length - 1) return null;
  return active[i + 1].route as QuestionRoute;
}

/** Headline for a screen, so no two screens share a title again. */
export function stepTitle(route: StepRoute): string {
  return STEPS.find((step) => step.route === route)?.title ?? "";
}

/** A step that can be navigated to. The entry grid is never a Next target. */
export type QuestionRoute = Exclude<StepRoute, "whats-wrong">;

/** Expo Router path for a question step. */
export function stepPath(route: QuestionRoute): `/(emergency)/${QuestionRoute}` {
  return `/(emergency)/${route}`;
}
