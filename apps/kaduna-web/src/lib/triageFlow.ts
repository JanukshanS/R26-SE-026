// The adaptive triage questionnaire, ported from apps/mobile/lib/emergencyFlow.ts
// plus the option lists of the app/(emergency)/* screens it sequences. There is
// no questions endpoint — the questionnaire is client-defined on both clients,
// so this file is the web half of that contract. Enum values are cross-checked
// against components/dispatch/src/utils/validators.ts.
//
// STEPS order is the mobile order, which is ranked by how much the trained tree
// leans on each answer. Reordering it here would silently diverge from the
// ordering apps/mobile/__tests__/emergency-flow-order.test.ts guards.

export const NOT_ASKED = "NOT_ASKED";

/** Q1 answers that skip the questionnaire and dispatch straight away. */
export const FAST_INTENTS = [
  "LOCKOUT",
  "FLAT_TIRE",
  "FUEL_EMPTY",
  "FUEL_WRONG",
  "MAJOR_CRASH",
  "FUEL_LEAK_FIRE_RISK",
  "LIGHT_BULB",
  "BLOWN_FUSE",
  "KEY_LOST",
  "STUCK_FLOOD",
] as const;

/** Q1 answers that enter the adaptive questionnaire. */
export const ML_INTENTS = [
  "WONT_START",
  "ENGINE_PROBLEM",
  "WEIRD_BEHAVIOR",
  "BRAKE_ISSUE",
  "GEAR_ISSUE",
] as const;

export function isFastIntent(intent: string | null): boolean {
  return !!intent && (FAST_INTENTS as readonly string[]).includes(intent);
}

export interface SLContext {
  location_type: string;
  recent_rain: string;
  parked_overnight: string;
  vehicle_age_bucket: string;
  last_fueled: string;
}

/** In-progress answers. `null` means the question hasn't been answered yet. */
export interface Answers {
  Q1_intent: string | null;
  Q2_engine_start: string | null;
  Q2b_running_issue: string | null;
  Q3_sound: string | null;
  Q3b_electrical: string | null;
  Q4_noise_detail: string | null;
  Q7_overheat_detail: string | null;
  Q8_smoke_color: string | null;
  Q_brake_detail: string | null;
  Q_gear_detail: string | null;
  Q6_smells: string | null;
  /** Warning-lamp tile ids, not backend values — see LIGHT_TILES. */
  Q5_lights: string[];
  Q9_recent: string[];
  context: SLContext;
}

/** Mobile's SL-context defaults. Every field is required by the schema. */
export const DEFAULT_CONTEXT: SLContext = {
  location_type: "URBAN",
  recent_rain: "NONE",
  parked_overnight: "OUTDOOR",
  vehicle_age_bucket: "8_15",
  last_fueled: "WITHIN_WEEK",
};

export const EMPTY_ANSWERS: Answers = {
  Q1_intent: null,
  Q2_engine_start: null,
  Q2b_running_issue: null,
  Q3_sound: null,
  Q3b_electrical: null,
  Q4_noise_detail: null,
  Q7_overheat_detail: null,
  Q8_smoke_color: null,
  Q_brake_detail: null,
  Q_gear_detail: null,
  Q6_smells: null,
  Q5_lights: [],
  Q9_recent: [],
  context: DEFAULT_CONTEXT,
};

/**
 * Answering a branch selector invalidates everything the old branch collected.
 * Without this, backing up and picking a different branch would leak an answer
 * from the abandoned path into a field that has to be NOT_ASKED. Mirrors the
 * cascade in mobile's setQ1Intent / setEngineState / setRunningIssue.
 */
const CLEARS: Record<string, (keyof Answers)[]> = {
  Q1_intent: [
    "Q2_engine_start",
    "Q2b_running_issue",
    "Q3_sound",
    "Q3b_electrical",
    "Q4_noise_detail",
    "Q7_overheat_detail",
    "Q8_smoke_color",
    "Q_brake_detail",
    "Q_gear_detail",
  ],
  Q2_engine_start: [
    "Q2b_running_issue",
    "Q3_sound",
    "Q3b_electrical",
    "Q4_noise_detail",
    "Q7_overheat_detail",
    "Q8_smoke_color",
  ],
  Q2b_running_issue: ["Q4_noise_detail", "Q7_overheat_detail", "Q8_smoke_color"],
};

/** Set one single-select answer, clearing any branch it invalidates. */
export function answer(prev: Answers, key: keyof Answers, value: string): Answers {
  if (prev[key] === value) return prev;
  const next: Answers = { ...prev, [key]: value };
  for (const dead of CLEARS[key] ?? []) next[dead] = null as never;
  return next;
}

/** Toggle a value in a multi-select. "NO_SIGNS" is exclusive with the rest. */
export function toggle(list: string[], value: string): string[] {
  if (value === "NO_SIGNS") return list.includes("NO_SIGNS") ? [] : ["NO_SIGNS"];
  const without = list.filter((v) => v !== "NO_SIGNS" && v !== value);
  return list.includes(value) ? without : [...without, value];
}

// ─── Q1 tiles ────────────────────────────────────────────────────────────

export interface IntentTile {
  value: string;
  labelKey: string;
  /** lucide-react icon name, same as the mobile tile. */
  icon: string;
  /** Life-safety problem — red treatment. */
  urgent?: boolean;
  /** Show the 1990 ambulance line before dispatching. */
  ambulance?: boolean;
}

/** Fast path. Each maps to a service type in the backend's
 *  FAST_PATH_INTENT_TO_SERVICE and bypasses the ML tree. */
export const FAST_TILES: IntentTile[] = [
  { value: "FLAT_TIRE", labelKey: "triage.q1.intent.flatTire", icon: "Disc" },
  { value: "FUEL_EMPTY", labelKey: "triage.q1.intent.fuelEmpty", icon: "Fuel" },
  { value: "LOCKOUT", labelKey: "triage.q1.intent.lockout", icon: "LockKeyhole" },
  { value: "KEY_LOST", labelKey: "triage.q1.intent.keyLost", icon: "KeyRound" },
  { value: "FUEL_WRONG", labelKey: "triage.q1.intent.fuelWrong", icon: "Droplets" },
  { value: "BLOWN_FUSE", labelKey: "triage.q1.intent.blownFuse", icon: "Zap" },
  { value: "LIGHT_BULB", labelKey: "triage.q1.intent.lightBulb", icon: "Lightbulb" },
  { value: "STUCK_FLOOD", labelKey: "triage.q1.intent.stuckFlood", icon: "WavesHorizontal" },
  { value: "MAJOR_CRASH", labelKey: "triage.q1.intent.majorCrash", icon: "TriangleAlert", urgent: true, ambulance: true },
  { value: "FUEL_LEAK_FIRE_RISK", labelKey: "triage.q1.intent.fuelLeakFireRisk", icon: "Flame", urgent: true },
];

/** These five enter the adaptive questionnaire. */
export const ML_TILES: IntentTile[] = [
  { value: "WONT_START", labelKey: "triage.q1.intent.wontStart", icon: "CircleOff" },
  { value: "ENGINE_PROBLEM", labelKey: "triage.q1.intent.engineProblem", icon: "Cog" },
  { value: "BRAKE_ISSUE", labelKey: "triage.q1.intent.brakeIssue", icon: "CircleStop" },
  { value: "GEAR_ISSUE", labelKey: "triage.q1.intent.gearIssue", icon: "Settings2" },
  { value: "WEIRD_BEHAVIOR", labelKey: "triage.q1.intent.weirdBehavior", icon: "CircleQuestionMark" },
];

// ─── Warning-lamp tiles (Q5) ─────────────────────────────────────────────

/** Mobile's nine lamp tiles and the backend lamp each stands for. "Fuel" and
 *  "Other" both map to SERVICE — the closest analog the enum offers. */
export const LIGHT_TILES: { id: string; labelKey: string; value: string; icon: string }[] = [
  { id: "engine", labelKey: "triage.q5.lights.engine", value: "CHECK_ENGINE", icon: "Cog" },
  { id: "oil", labelKey: "triage.q5.lights.oil", value: "OIL", icon: "Droplet" },
  { id: "battery", labelKey: "triage.q5.lights.battery", value: "BATTERY", icon: "BatteryWarning" },
  { id: "brake", labelKey: "triage.q5.lights.brake", value: "BRAKE", icon: "OctagonAlert" },
  { id: "abs", labelKey: "triage.q5.lights.abs", value: "ABS", icon: "CircleSlash2" },
  { id: "fuel", labelKey: "triage.q5.lights.fuel", value: "SERVICE", icon: "Fuel" },
  { id: "tyre", labelKey: "triage.q5.lights.tyre", value: "TIRE_PRESSURE", icon: "CircleDot" },
  { id: "temp", labelKey: "triage.q5.lights.temp", value: "TEMPERATURE", icon: "Thermometer" },
  { id: "other", labelKey: "triage.q5.lights.other", value: "SERVICE", icon: "TriangleAlert" },
];

// ─── Steps ───────────────────────────────────────────────────────────────

export interface Option {
  value: string;
  titleKey: string;
  descriptionKey?: string;
  tone?: "warning" | "danger";
}

export interface ContextGroup {
  key: keyof SLContext;
  labelKey: string;
  options: { value: string; labelKey: string }[];
}

export interface Step {
  key: keyof Answers;
  kind: "intent" | "single" | "lights" | "multi" | "context";
  /** Short topic heading, so no two steps share a title. */
  titleKey: string;
  promptKey: string;
  hintKey?: string;
  options?: Option[];
  groups?: ContextGroup[];
  /** Active for these answers? Omitted = always asked. */
  when?: (a: Answers) => boolean;
}

const ENGINE_INTENTS = ["WONT_START", "ENGINE_PROBLEM", "WEIRD_BEHAVIOR"];

/**
 * Ordered exactly as mobile orders it: by the sample-weighted share of split
 * decisions each answer carries in components/dispatch/ml/exported_tree_tier1.json.
 * The first five steps carry 66.3% of the routing weight, which matters because
 * the driver can give up part-way through.
 */
export const STEPS: Step[] = [
  {
    key: "Q1_intent",
    kind: "intent",
    titleKey: "triage.q1.intent.title",
    promptKey: "triage.q1.intent.prompt",
    hintKey: "triage.q1.intent.hint",
  },
  // Q2 — 14.9%
  {
    key: "Q2_engine_start",
    kind: "single",
    titleKey: "triage.q2.engineStart.title",
    promptKey: "triage.q2.engineStart.prompt",
    when: (a) => !!a.Q1_intent && ENGINE_INTENTS.includes(a.Q1_intent),
    options: [
      { value: "STARTS_NORMAL", titleKey: "triage.q2.engineStart.startsNormal.title", descriptionKey: "triage.q2.engineStart.startsNormal.description" },
      { value: "STARTS_BUT_ISSUE", titleKey: "triage.q2.engineStart.startsButIssue.title", descriptionKey: "triage.q2.engineStart.startsButIssue.description" },
      { value: "CRANKS_NO_START", titleKey: "triage.q2.engineStart.cranksNoStart.title", descriptionKey: "triage.q2.engineStart.cranksNoStart.description" },
      { value: "NO_CRANK", titleKey: "triage.q2.engineStart.noCrank.title", descriptionKey: "triage.q2.engineStart.noCrank.description" },
    ],
  },
  // Q5 — 22.0%, the single heaviest question. Always asked.
  {
    key: "Q5_lights",
    kind: "lights",
    titleKey: "triage.q5.lights.title",
    promptKey: "triage.q5.lights.prompt",
    hintKey: "triage.q5.lights.hint",
  },
  // Q9 — 15.1%. Always asked.
  {
    key: "Q9_recent",
    kind: "multi",
    titleKey: "triage.q9.recent.title",
    promptKey: "triage.q9.recent.prompt",
    hintKey: "triage.q9.recent.hint",
    options: [
      { value: "HARD_START", titleKey: "triage.q9.recent.hardStart.title", descriptionKey: "triage.q9.recent.hardStart.description" },
      { value: "LIGHTS_FLICKER", titleKey: "triage.q9.recent.lightsFlicker.title", descriptionKey: "triage.q9.recent.lightsFlicker.description" },
      { value: "LOSS_OF_POWER", titleKey: "triage.q9.recent.lossOfPower.title", descriptionKey: "triage.q9.recent.lossOfPower.description" },
      { value: "OVERHEATING_BEFORE", titleKey: "triage.q9.recent.overheatingBefore.title", descriptionKey: "triage.q9.recent.overheatingBefore.description" },
      { value: "UNUSUAL_NOISE", titleKey: "triage.q9.recent.unusualNoise.title", descriptionKey: "triage.q9.recent.unusualNoise.description" },
      { value: "SMELL_BEFORE", titleKey: "triage.q9.recent.smellBefore.title", descriptionKey: "triage.q9.recent.smellBefore.description" },
      { value: "NO_SIGNS", titleKey: "triage.q9.recent.noSigns.title", descriptionKey: "triage.q9.recent.noSigns.description" },
    ],
  },
  // Q6 — 10.8%. Always asked.
  {
    key: "Q6_smells",
    kind: "single",
    titleKey: "triage.q6.smells.title",
    promptKey: "triage.q6.smells.prompt",
    options: [
      { value: "BURNING_ELECTRICAL", titleKey: "triage.q6.smells.burningElectrical.title", descriptionKey: "triage.q6.smells.burningElectrical.description", tone: "danger" },
      { value: "BURNING_OIL", titleKey: "triage.q6.smells.burningOil.title", descriptionKey: "triage.q6.smells.burningOil.description" },
      { value: "FUEL_SMELL", titleKey: "triage.q6.smells.fuelSmell.title", descriptionKey: "triage.q6.smells.fuelSmell.description", tone: "danger" },
      { value: "ROTTEN_EGGS", titleKey: "triage.q6.smells.rottenEggs.title", descriptionKey: "triage.q6.smells.rottenEggs.description" },
      { value: "SWEET", titleKey: "triage.q6.smells.sweet.title", descriptionKey: "triage.q6.smells.sweet.description" },
      { value: "NO_SMELL", titleKey: "triage.q6.smells.noSmell.title", descriptionKey: "triage.q6.smells.noSmell.description" },
    ],
  },
  // Q2b — 7.2%. Still ahead of every branch detail that reads it.
  {
    key: "Q2b_running_issue",
    kind: "single",
    titleKey: "triage.q2b.runningIssue.title",
    promptKey: "triage.q2b.runningIssue.prompt",
    when: (a) =>
      a.Q2_engine_start === "STARTS_NORMAL" || a.Q2_engine_start === "STARTS_BUT_ISSUE",
    options: [
      { value: "OVERHEATING", titleKey: "triage.q2b.runningIssue.overheating.title", descriptionKey: "triage.q2b.runningIssue.overheating.description" },
      { value: "NOISE", titleKey: "triage.q2b.runningIssue.noise.title", descriptionKey: "triage.q2b.runningIssue.noise.description" },
      { value: "NO_POWER", titleKey: "triage.q2b.runningIssue.noPower.title", descriptionKey: "triage.q2b.runningIssue.noPower.description" },
      { value: "SMOKE", titleKey: "triage.q2b.runningIssue.smoke.title", descriptionKey: "triage.q2b.runningIssue.smoke.description" },
      { value: "STALLING", titleKey: "triage.q2b.runningIssue.stalling.title", descriptionKey: "triage.q2b.runningIssue.stalling.description" },
    ],
  },
  // Branch detail — at most one of these is ever active.
  {
    key: "Q3_sound",
    kind: "single",
    titleKey: "triage.q3.sound.title",
    promptKey: "triage.q3.sound.prompt",
    hintKey: "triage.q3.sound.hint",
    when: (a) => a.Q2_engine_start === "CRANKS_NO_START",
    options: [
      { value: "RAPID_CLICKING", titleKey: "triage.q3.sound.rapidClicking.title" },
      { value: "NORMAL_CRANKING", titleKey: "triage.q3.sound.normalCranking.title" },
      { value: "GRINDING", titleKey: "triage.q3.sound.grinding.title" },
      { value: "NOTHING", titleKey: "triage.q3.sound.nothing.title" },
    ],
  },
  {
    key: "Q3b_electrical",
    kind: "single",
    titleKey: "triage.q3b.electrical.title",
    promptKey: "triage.q3b.electrical.prompt",
    when: (a) => a.Q2_engine_start === "NO_CRANK",
    options: [
      { value: "ALL_DEAD_NO_LIGHTS", titleKey: "triage.q3b.electrical.allDeadNoLights.title", descriptionKey: "triage.q3b.electrical.allDeadNoLights.description" },
      { value: "DIM_LIGHTS", titleKey: "triage.q3b.electrical.dimLights.title", descriptionKey: "triage.q3b.electrical.dimLights.description" },
      { value: "SOME_LIGHTS_ON", titleKey: "triage.q3b.electrical.someLightsOn.title", descriptionKey: "triage.q3b.electrical.someLightsOn.description" },
    ],
  },
  {
    key: "Q7_overheat_detail",
    kind: "single",
    titleKey: "triage.q7.overheatDetail.title",
    promptKey: "triage.q7.overheatDetail.prompt",
    when: (a) => a.Q2b_running_issue === "OVERHEATING",
    options: [
      { value: "TRAFFIC_ONLY", titleKey: "triage.q7.overheatDetail.trafficOnly.title", descriptionKey: "triage.q7.overheatDetail.trafficOnly.description" },
      { value: "ALWAYS", titleKey: "triage.q7.overheatDetail.always.title", descriptionKey: "triage.q7.overheatDetail.always.description" },
      { value: "HILL_CLIMB", titleKey: "triage.q7.overheatDetail.hillClimb.title", descriptionKey: "triage.q7.overheatDetail.hillClimb.description" },
      { value: "WITH_AC", titleKey: "triage.q7.overheatDetail.withAc.title", descriptionKey: "triage.q7.overheatDetail.withAc.description" },
    ],
  },
  {
    key: "Q4_noise_detail",
    kind: "single",
    titleKey: "triage.q4.noiseDetail.title",
    promptKey: "triage.q4.noiseDetail.prompt",
    when: (a) => a.Q2b_running_issue === "NOISE",
    options: [
      { value: "SQUEAL", titleKey: "triage.q4.noiseDetail.squeal.title", descriptionKey: "triage.q4.noiseDetail.squeal.description" },
      { value: "KNOCK", titleKey: "triage.q4.noiseDetail.knock.title", descriptionKey: "triage.q4.noiseDetail.knock.description" },
      { value: "GRIND", titleKey: "triage.q4.noiseDetail.grind.title", descriptionKey: "triage.q4.noiseDetail.grind.description" },
      { value: "WHINE", titleKey: "triage.q4.noiseDetail.whine.title", descriptionKey: "triage.q4.noiseDetail.whine.description" },
      { value: "CLUNK", titleKey: "triage.q4.noiseDetail.clunk.title", descriptionKey: "triage.q4.noiseDetail.clunk.description" },
    ],
  },
  {
    key: "Q8_smoke_color",
    kind: "single",
    titleKey: "triage.q8.smokeColor.title",
    promptKey: "triage.q8.smokeColor.prompt",
    when: (a) => a.Q2b_running_issue === "SMOKE",
    options: [
      { value: "WHITE", titleKey: "triage.q8.smokeColor.white.title", descriptionKey: "triage.q8.smokeColor.white.description", tone: "warning" },
      { value: "BLUE_GREY", titleKey: "triage.q8.smokeColor.blueGrey.title", descriptionKey: "triage.q8.smokeColor.blueGrey.description", tone: "warning" },
      { value: "BLACK", titleKey: "triage.q8.smokeColor.black.title", descriptionKey: "triage.q8.smokeColor.black.description" },
      { value: "ELECTRICAL_BURNING", titleKey: "triage.q8.smokeColor.electricalBurning.title", descriptionKey: "triage.q8.smokeColor.electricalBurning.description", tone: "danger" },
    ],
  },
  {
    key: "Q_brake_detail",
    kind: "single",
    titleKey: "triage.q.brakeDetail.title",
    promptKey: "triage.q.brakeDetail.prompt",
    when: (a) => a.Q1_intent === "BRAKE_ISSUE",
    options: [
      { value: "SQUEALING", titleKey: "triage.q.brakeDetail.squealing.title", descriptionKey: "triage.q.brakeDetail.squealing.description" },
      { value: "GRINDING", titleKey: "triage.q.brakeDetail.grinding.title", descriptionKey: "triage.q.brakeDetail.grinding.description", tone: "warning" },
      { value: "PULL_ONE_SIDE", titleKey: "triage.q.brakeDetail.pullOneSide.title", descriptionKey: "triage.q.brakeDetail.pullOneSide.description" },
      { value: "SOFT_PEDAL", titleKey: "triage.q.brakeDetail.softPedal.title", descriptionKey: "triage.q.brakeDetail.softPedal.description", tone: "danger" },
    ],
  },
  {
    key: "Q_gear_detail",
    kind: "single",
    titleKey: "triage.q.gearDetail.title",
    promptKey: "triage.q.gearDetail.prompt",
    when: (a) => a.Q1_intent === "GEAR_ISSUE",
    options: [
      { value: "SLIPPING", titleKey: "triage.q.gearDetail.slipping.title", descriptionKey: "triage.q.gearDetail.slipping.description" },
      { value: "WONT_ENGAGE", titleKey: "triage.q.gearDetail.wontEngage.title", descriptionKey: "triage.q.gearDetail.wontEngage.description" },
      { value: "GRINDING", titleKey: "triage.q.gearDetail.grinding.title", descriptionKey: "triage.q.gearDetail.grinding.description" },
      { value: "CLUTCH_SOFT", titleKey: "triage.q.gearDetail.clutchSoft.title", descriptionKey: "triage.q.gearDetail.clutchSoft.description" },
    ],
  },
  // 8.3% across last_fueled, recent_rain and parked_overnight. Its location
  // question was dropped from the feature set by the v3 retrain.
  {
    key: "context",
    kind: "context",
    titleKey: "triage.context.title",
    promptKey: "triage.context.prompt",
    groups: [
      {
        key: "location_type",
        labelKey: "triage.context.locationType.label",
        options: [
          { value: "COASTAL", labelKey: "triage.context.locationType.coastal" },
          { value: "HILL", labelKey: "triage.context.locationType.hill" },
          { value: "URBAN", labelKey: "triage.context.locationType.urban" },
          { value: "RURAL", labelKey: "triage.context.locationType.rural" },
        ],
      },
      {
        key: "recent_rain",
        labelKey: "triage.context.recentRain.label",
        options: [
          { value: "NONE", labelKey: "triage.context.recentRain.none" },
          { value: "YESTERDAY", labelKey: "triage.context.recentRain.yesterday" },
          { value: "WITHIN_3_DAYS", labelKey: "triage.context.recentRain.within3Days" },
          { value: "MONSOON", labelKey: "triage.context.recentRain.monsoon" },
        ],
      },
      {
        key: "parked_overnight",
        labelKey: "triage.context.parkedOvernight.label",
        options: [
          { value: "INDOOR", labelKey: "triage.context.parkedOvernight.indoor" },
          { value: "OUTDOOR", labelKey: "triage.context.parkedOvernight.outdoor" },
        ],
      },
      {
        key: "vehicle_age_bucket",
        labelKey: "triage.context.vehicleAgeBucket.label",
        options: [
          { value: "UNDER_3", labelKey: "triage.context.vehicleAgeBucket.under3" },
          { value: "3_7", labelKey: "triage.context.vehicleAgeBucket.from3To7" },
          { value: "8_15", labelKey: "triage.context.vehicleAgeBucket.from8To15" },
          { value: "OVER_15", labelKey: "triage.context.vehicleAgeBucket.over15" },
        ],
      },
      {
        key: "last_fueled",
        labelKey: "triage.context.lastFueled.label",
        options: [
          { value: "TODAY_NEW_STATION", labelKey: "triage.context.lastFueled.todayNewStation" },
          { value: "TODAY_USUAL", labelKey: "triage.context.lastFueled.todayUsual" },
          { value: "WITHIN_WEEK", labelKey: "triage.context.lastFueled.withinWeek" },
          { value: "OVER_WEEK", labelKey: "triage.context.lastFueled.overWeek" },
        ],
      },
    ],
  },
];

/**
 * The steps this driver will actually see. A fast-path intent ends the
 * questionnaire at Q1 — the backend short-circuits ML for those anyway.
 */
export function flowSteps(a: Answers): Step[] {
  if (isFastIntent(a.Q1_intent)) return STEPS.slice(0, 1);
  return STEPS.filter((s) => !s.when || s.when(a));
}

/** Whether this step has an answer good enough to move on from. */
export function isAnswered(step: Step, a: Answers): boolean {
  // Lights is the one question with a valid empty answer — "no lights on".
  if (step.kind === "lights" || step.kind === "context") return true;
  if (step.kind === "multi") return (a[step.key] as string[]).length > 0;
  return a[step.key] !== null;
}

/**
 * The payload the dispatch backend validates against triageResponsesSchema.
 * Unvisited branches submit NOT_ASKED; the fields whose enums carry no
 * NOT_ASKED member (Q6_smells, Q5_lights, Q9_recent, the five context fields)
 * get the same asserted defaults mobile uses.
 */
export function buildTriageResponses(a: Answers): Record<string, unknown> {
  const lights = [
    ...new Set(
      a.Q5_lights
        .map((id) => LIGHT_TILES.find((t) => t.id === id)?.value)
        .filter((v): v is string => !!v)
    ),
  ];

  return {
    Q1_intent: a.Q1_intent,
    Q2_engine_start: a.Q2_engine_start ?? NOT_ASKED,
    Q2b_running_issue: a.Q2b_running_issue ?? NOT_ASKED,
    Q3_sound: a.Q3_sound ?? NOT_ASKED,
    Q3b_electrical: a.Q3b_electrical ?? NOT_ASKED,
    Q4_noise_detail: a.Q4_noise_detail ?? NOT_ASKED,
    Q7_overheat_detail: a.Q7_overheat_detail ?? NOT_ASKED,
    Q8_smoke_color: a.Q8_smoke_color ?? NOT_ASKED,
    Q_brake_detail: a.Q_brake_detail ?? NOT_ASKED,
    Q_gear_detail: a.Q_gear_detail ?? NOT_ASKED,
    Q6_smells: a.Q6_smells ?? "NO_SMELL",
    Q5_lights: lights.length ? lights : ["NONE"],
    Q9_recent: a.Q9_recent.length ? a.Q9_recent : ["NO_SIGNS"],
    ...a.context,
  };
}
