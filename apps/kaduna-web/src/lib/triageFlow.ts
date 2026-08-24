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
  label: string;
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
  { value: "FLAT_TIRE", label: "Flat tyre", icon: "Disc" },
  { value: "FUEL_EMPTY", label: "Out of fuel", icon: "Fuel" },
  { value: "LOCKOUT", label: "Locked out", icon: "LockKeyhole" },
  { value: "KEY_LOST", label: "Lost my key", icon: "KeyRound" },
  { value: "FUEL_WRONG", label: "Wrong fuel", icon: "Droplets" },
  { value: "BLOWN_FUSE", label: "Blown fuse", icon: "Zap" },
  { value: "LIGHT_BULB", label: "Light bulb", icon: "Lightbulb" },
  { value: "STUCK_FLOOD", label: "Stuck in flood", icon: "WavesHorizontal" },
  { value: "MAJOR_CRASH", label: "Accident", icon: "TriangleAlert", urgent: true, ambulance: true },
  { value: "FUEL_LEAK_FIRE_RISK", label: "Fuel leak / fire", icon: "Flame", urgent: true },
];

/** These five enter the adaptive questionnaire. */
export const ML_TILES: IntentTile[] = [
  { value: "WONT_START", label: "Won't start", icon: "CircleOff" },
  { value: "ENGINE_PROBLEM", label: "Engine trouble", icon: "Cog" },
  { value: "BRAKE_ISSUE", label: "Brakes", icon: "CircleStop" },
  { value: "GEAR_ISSUE", label: "Gears / clutch", icon: "Settings2" },
  { value: "WEIRD_BEHAVIOR", label: "Not sure", icon: "CircleQuestionMark" },
];

// ─── Warning-lamp tiles (Q5) ─────────────────────────────────────────────

/** Mobile's nine lamp tiles and the backend lamp each stands for. "Fuel" and
 *  "Other" both map to SERVICE — the closest analog the enum offers. */
export const LIGHT_TILES: { id: string; label: string; value: string; icon: string }[] = [
  { id: "engine", label: "Engine", value: "CHECK_ENGINE", icon: "Cog" },
  { id: "oil", label: "Oil", value: "OIL", icon: "Droplet" },
  { id: "battery", label: "Battery", value: "BATTERY", icon: "BatteryWarning" },
  { id: "brake", label: "Brake", value: "BRAKE", icon: "OctagonAlert" },
  { id: "abs", label: "ABS", value: "ABS", icon: "CircleSlash2" },
  { id: "fuel", label: "Fuel", value: "SERVICE", icon: "Fuel" },
  { id: "tyre", label: "Tyre", value: "TIRE_PRESSURE", icon: "CircleDot" },
  { id: "temp", label: "Temp", value: "TEMPERATURE", icon: "Thermometer" },
  { id: "other", label: "Other", value: "SERVICE", icon: "TriangleAlert" },
];

// ─── Steps ───────────────────────────────────────────────────────────────

export interface Option {
  value: string;
  title: string;
  description?: string;
  tone?: "warning" | "danger";
}

export interface ContextGroup {
  key: keyof SLContext;
  label: string;
  options: { value: string; label: string }[];
}

export interface Step {
  key: keyof Answers;
  kind: "intent" | "single" | "lights" | "multi" | "context";
  /** Short topic heading, so no two steps share a title. */
  title: string;
  prompt: string;
  hint?: string;
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
    title: "What's wrong?",
    prompt: "What's wrong?",
    hint: "Pick the closest one. We'll sort out the details after help is on its way.",
  },
  // Q2 — 14.9%
  {
    key: "Q2_engine_start",
    kind: "single",
    title: "Engine",
    prompt: "What's the engine doing right now?",
    when: (a) => !!a.Q1_intent && ENGINE_INTENTS.includes(a.Q1_intent),
    options: [
      { value: "STARTS_NORMAL", title: "Starts and runs normally", description: "Engine fires up and idles" },
      { value: "STARTS_BUT_ISSUE", title: "Starts but runs rough", description: "Stalls, shakes, or misfires" },
      { value: "CRANKS_NO_START", title: "Cranks but won't fire", description: "Engine turns but doesn't catch" },
      { value: "NO_CRANK", title: "Completely dead", description: "No response at all when key turned" },
    ],
  },
  // Q5 — 22.0%, the single heaviest question. Always asked.
  {
    key: "Q5_lights",
    kind: "lights",
    title: "Warning lights",
    prompt: "Which dashboard lights are on?",
    hint: "Select all the warning lights you can see. Leave it empty if there are none.",
  },
  // Q9 — 15.1%. Always asked.
  {
    key: "Q9_recent",
    kind: "multi",
    title: "Recent warning signs",
    prompt: "Any warning signs in the past few days?",
    hint: "Select all that apply.",
    options: [
      { value: "HARD_START", title: "Engine was harder to start", description: "Cranking has been getting slower" },
      { value: "LIGHTS_FLICKER", title: "Dashboard lights flickering", description: "Lights dim or flicker while driving" },
      { value: "LOSS_OF_POWER", title: "Lost power while driving", description: "Sudden drop in acceleration" },
      { value: "OVERHEATING_BEFORE", title: "Temperature gauge went up", description: "Engine ran hot before" },
      { value: "UNUSUAL_NOISE", title: "Unusual noise recently", description: "New rattle, squeal, or grind" },
      { value: "SMELL_BEFORE", title: "Noticed a smell in past days", description: "Something didn't smell right" },
      { value: "NO_SIGNS", title: "No warning signs", description: "Happened suddenly with no warning" },
    ],
  },
  // Q6 — 10.8%. Always asked.
  {
    key: "Q6_smells",
    kind: "single",
    title: "Smell",
    prompt: "Do you notice any unusual smells?",
    options: [
      { value: "BURNING_ELECTRICAL", title: "Burning plastic / electrical", description: "Wiring or alternator overheating", tone: "danger" },
      { value: "BURNING_OIL", title: "Burning oil / rubber", description: "Oil leak onto exhaust or belt slipping" },
      { value: "FUEL_SMELL", title: "Strong petrol / diesel smell", description: "Possible fuel leak — do not start", tone: "danger" },
      { value: "ROTTEN_EGGS", title: "Rotten eggs / sulfur", description: "Catalytic converter or battery overcharge" },
      { value: "SWEET", title: "Sweet smell", description: "Coolant leak (antifreeze)" },
      { value: "NO_SMELL", title: "No unusual smell", description: "Nothing different" },
    ],
  },
  // Q2b — 7.2%. Still ahead of every branch detail that reads it.
  {
    key: "Q2b_running_issue",
    kind: "single",
    title: "Running problem",
    prompt: "What's the main problem while the engine runs?",
    when: (a) =>
      a.Q2_engine_start === "STARTS_NORMAL" || a.Q2_engine_start === "STARTS_BUT_ISSUE",
    options: [
      { value: "OVERHEATING", title: "Overheating", description: "Temperature gauge climbing into the red" },
      { value: "NOISE", title: "Strange noise", description: "Squeal, knock, grind, whine, clunk" },
      { value: "NO_POWER", title: "No power / won't accelerate", description: "Engine runs but loses power under load" },
      { value: "SMOKE", title: "Smoke from engine", description: "Visible smoke from the engine bay or exhaust" },
      { value: "STALLING", title: "Engine stalls / dies", description: "Cuts out while idling or driving" },
    ],
  },
  // Branch detail — at most one of these is ever active.
  {
    key: "Q3_sound",
    kind: "single",
    title: "Sound",
    prompt: "What sound does your vehicle make?",
    hint: "Pick the sound that best matches when you turn the key.",
    when: (a) => a.Q2_engine_start === "CRANKS_NO_START",
    options: [
      { value: "RAPID_CLICKING", title: "Rapid clicking" },
      { value: "NORMAL_CRANKING", title: "Normal cranking" },
      { value: "GRINDING", title: "Grinding noise" },
      { value: "NOTHING", title: "Nothing at all" },
    ],
  },
  {
    key: "Q3b_electrical",
    kind: "single",
    title: "Lights and power",
    prompt: "What are the dashboard lights doing?",
    when: (a) => a.Q2_engine_start === "NO_CRANK",
    options: [
      { value: "ALL_DEAD_NO_LIGHTS", title: "No lights at all", description: "Dashboard completely dark — battery flat or terminal off" },
      { value: "DIM_LIGHTS", title: "Lights dim or flickering", description: "Battery has some charge but not enough to crank" },
      { value: "SOME_LIGHTS_ON", title: "Some lights normal", description: "Power is there — starter or ignition fault" },
    ],
  },
  {
    key: "Q7_overheat_detail",
    kind: "single",
    title: "Overheating",
    prompt: "When does the overheating happen?",
    when: (a) => a.Q2b_running_issue === "OVERHEATING",
    options: [
      { value: "TRAFFIC_ONLY", title: "Only in heavy traffic / when stopped", description: "Cools down when moving — typical radiator-fan failure" },
      { value: "ALWAYS", title: "Even when driving normally", description: "Constant overheat — coolant loss or head gasket" },
      { value: "HILL_CLIMB", title: "Only when climbing hills", description: "Engine load too high for the cooling system" },
      { value: "WITH_AC", title: "Only when AC is running", description: "Extra heat load from the AC condenser" },
    ],
  },
  {
    key: "Q4_noise_detail",
    kind: "single",
    title: "Noise",
    prompt: "What kind of noise are you hearing?",
    when: (a) => a.Q2b_running_issue === "NOISE",
    options: [
      { value: "SQUEAL", title: "High-pitched squealing", description: "Belt slipping or worn" },
      { value: "KNOCK", title: "Knocking (rhythmic)", description: "Engine timing or fuel-quality issue" },
      { value: "GRIND", title: "Grinding", description: "Brakes, starter, or bearing" },
      { value: "WHINE", title: "High-pitched whining", description: "Alternator or power-steering" },
      { value: "CLUNK", title: "Clunking (intermittent)", description: "Drivetrain or suspension" },
    ],
  },
  {
    key: "Q8_smoke_color",
    kind: "single",
    title: "Smoke",
    prompt: "What colour is the smoke?",
    when: (a) => a.Q2b_running_issue === "SMOKE",
    options: [
      { value: "WHITE", title: "White smoke / steam", description: "Coolant — possible head gasket", tone: "warning" },
      { value: "BLUE_GREY", title: "Blue / grey smoke", description: "Burning oil — worn rings or valve seals", tone: "warning" },
      { value: "BLACK", title: "Black smoke", description: "Too much fuel — injector / filter issue" },
      { value: "ELECTRICAL_BURNING", title: "Smoke from dashboard / bonnet", description: "STOP ENGINE — electrical fire risk", tone: "danger" },
    ],
  },
  {
    key: "Q_brake_detail",
    kind: "single",
    title: "Brakes",
    prompt: "What's the brake doing?",
    when: (a) => a.Q1_intent === "BRAKE_ISSUE",
    options: [
      { value: "SQUEALING", title: "Squealing under braking", description: "Pad wear indicator — replace pads soon" },
      { value: "GRINDING", title: "Grinding (metal-on-metal)", description: "Pads are gone — replace immediately", tone: "warning" },
      { value: "PULL_ONE_SIDE", title: "Pulls to one side", description: "Caliper or hose issue" },
      { value: "SOFT_PEDAL", title: "Pedal is soft / sinks", description: "Hydraulic failure — DO NOT DRIVE", tone: "danger" },
    ],
  },
  {
    key: "Q_gear_detail",
    kind: "single",
    title: "Gears",
    prompt: "What's the gearbox doing?",
    when: (a) => a.Q1_intent === "GEAR_ISSUE",
    options: [
      { value: "SLIPPING", title: "Revs rise but no speed gain", description: "Clutch slipping" },
      { value: "WONT_ENGAGE", title: "Gear won't engage", description: "Transmission issue" },
      { value: "GRINDING", title: "Grinding when shifting", description: "Synchros worn / clutch not disengaging" },
      { value: "CLUTCH_SOFT", title: "Clutch pedal soft / sinks to the floor", description: "Clutch hydraulic failure" },
    ],
  },
  // 8.3% across last_fueled, recent_rain and parked_overnight. Its location
  // question was dropped from the feature set by the v3 retrain.
  {
    key: "context",
    kind: "context",
    title: "One last thing",
    prompt: "These help us narrow down the most likely fault for Sri Lankan conditions.",
    groups: [
      {
        key: "location_type",
        label: "Where are you?",
        options: [
          { value: "COASTAL", label: "Coastal" },
          { value: "HILL", label: "Hill country" },
          { value: "URBAN", label: "City / town" },
          { value: "RURAL", label: "Rural" },
        ],
      },
      {
        key: "recent_rain",
        label: "Recent rain in your area?",
        options: [
          { value: "NONE", label: "No rain" },
          { value: "YESTERDAY", label: "Yesterday" },
          { value: "WITHIN_3_DAYS", label: "Past 3 days" },
          { value: "MONSOON", label: "Monsoon — heavy" },
        ],
      },
      {
        key: "parked_overnight",
        label: "Where was it parked overnight?",
        options: [
          { value: "INDOOR", label: "Garage / covered" },
          { value: "OUTDOOR", label: "Open / street" },
        ],
      },
      {
        key: "vehicle_age_bucket",
        label: "How old is the vehicle?",
        options: [
          { value: "UNDER_3", label: "< 3 yr" },
          { value: "3_7", label: "3-7 yr" },
          { value: "8_15", label: "8-15 yr" },
          { value: "OVER_15", label: "> 15 yr" },
        ],
      },
      {
        key: "last_fueled",
        label: "When did you last fuel up?",
        options: [
          { value: "TODAY_NEW_STATION", label: "Today — new station" },
          { value: "TODAY_USUAL", label: "Today — usual station" },
          { value: "WITHIN_WEEK", label: "Within past week" },
          { value: "OVER_WEEK", label: "Over a week ago" },
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
