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
 * (sample-weighted share of split decisions):
 *
 *     Q2b_running_issue  29.0%   ← root split
 *     Q5_lights          17.3%
 *     Q2_engine_start    15.2%
 *     Q9_recent          14.9%
 *     location_type       4.9%
 *     Q3_sound            4.9%
 *     Q1_intent           2.6%
 *     ...everything else  <2% each
 *
 * The old order asked Q5 sixth and Q9 eighth, behind branch questions worth
 * under 2% — and behind two (Q4_noise_detail, Q8_smoke_color) that never
 * appear as a split feature in EITHER exported tree. Since the driver can now
 * bail at any step (see SKIP below), question order decides how much signal
 * the model gets from someone who stops early.
 *
 * Moving Q5 and Q9 earlier is answer-preserving: both are asked unconditionally
 * on every path, so re-sequencing them cannot change WHICH questions a given
 * driver sees — only the order. Every conditional branch below keeps exactly the
 * predicate it had before, so the model never sees a combination it wasn't
 * trained on.
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
  | "smells"
  | "context";

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
  // Q2 — 15.2%
  { route: "engine-state",     title: "Engine",
    when: (s) => s.q1Intent != null && ENGINE_INTENTS.includes(s.q1Intent) },
  // Q2b — 29.0%, the tree's root split
  { route: "running-issue",    title: "Running problem",
    when: (s) => s.engineState === "STARTS_NORMAL" || s.engineState === "STARTS_BUT_ISSUE" },
  // Q5 — 17.3%. Always asked, moved up from step 6.
  { route: "diagnosis-lights", title: "Warning lights" },
  // Q9 — 14.9%. Always asked, moved up from step 8.
  { route: "recent",           title: "Recent warning signs" },
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
  // Tail — 1.9% and 3.6% combined, so they go last.
  { route: "smells",           title: "Smell" },
  { route: "context",          title: "One last thing" },
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
