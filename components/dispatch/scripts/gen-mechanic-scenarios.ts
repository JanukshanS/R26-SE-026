/**
 * Builds the garage-visit validation set: 10 real questionnaire rows, one per
 * fault family, run through the Tier-1 triage engine and the dispatch gate +
 * ECM, with every question/answer rendered in the mobile app's English wording.
 *
 * Row choice is outcome-blind: for each target service_type, take the real
 * row whose answers follow the mobile flow exactly and carry the most
 * information (answered branch questions, lamps, warning signs, smell);
 * ties go to the lowest row index. The engine result never influences it.
 *
 * Run:  npx ts-node --transpile-only scripts/gen-mechanic-scenarios.ts [outPath]
 */
import fs from 'fs';
import path from 'path';
import emergency from '../../../apps/mobile/locales/en/emergency';
import common from '../../../apps/mobile/locales/en/common';

const t = (k: string) => {
  const s = emergency[k] ?? common[k];
  if (!s) throw new Error(`missing app string ${k}`);
  return s;
};

const NA = 'NOT_ASKED';
const CSV = path.resolve(__dirname, '..', 'ml', 'files', 'questionnaire_final_v3.csv');
const OUT = process.argv[2] ?? path.resolve(__dirname, '..', '..', '..', '..', '..',
  'RP/cursorgenerateddocs/pp2-validation/garage-visit-2026-10-10/mechanic-scenarios.json');

const TARGETS = [
  'BATTERY_JUMP', 'STARTER_MOTOR', 'ALTERNATOR_ISSUE', 'FUEL_PUMP', 'RADIATOR_FAN_ISSUE',
  'BRAKE_PAD_WORN', 'CLUTCH_WORN', 'ELECTRICAL_FAULT_RAIN', 'BELT_BROKEN', 'SEVERE_MECHANICAL_TOW',
];

// ── code → app string key (mirrors the OPTIONS arrays in apps/mobile/app/(emergency)/*.tsx) ──
// Ordered as the mobile flow asks them (lib/emergencyFlow.ts), context last.
const QUESTIONS: { field: string; prompt: string; options: Record<string, string> }[] = [
  { field: 'Q1_intent', prompt: 'emergency.whatsWrong.title', options: {
    WONT_START: 'emergency.problem.wontStart', ENGINE_PROBLEM: 'emergency.problem.engineTrouble',
    BRAKE_ISSUE: 'emergency.problem.brakes', GEAR_ISSUE: 'emergency.problem.gears',
    WEIRD_BEHAVIOR: 'emergency.problem.notSure' } },
  { field: 'Q2_engine_start', prompt: 'emergency.engineState.prompt', options: {
    STARTS_NORMAL: 'emergency.engineState.startsNormalTitle', STARTS_BUT_ISSUE: 'emergency.engineState.startsRoughTitle',
    CRANKS_NO_START: 'emergency.engineState.cranksNoStartTitle', NO_CRANK: 'emergency.engineState.noCrankTitle' } },
  { field: 'Q5_lights', prompt: 'emergency.lights.prompt', options: {
    CHECK_ENGINE: 'emergency.lights.engine', OIL: 'emergency.lights.oil', BATTERY: 'emergency.lights.battery',
    BRAKE: 'emergency.lights.brake', ABS: 'emergency.lights.abs', SERVICE: 'emergency.lights.other',
    TIRE_PRESSURE: 'emergency.lights.tyre', TEMPERATURE: 'emergency.lights.temp' } },
  { field: 'Q9_recent', prompt: 'emergency.recent.prompt', options: {
    HARD_START: 'emergency.recent.hardStartTitle', LIGHTS_FLICKER: 'emergency.recent.flickerTitle',
    LOSS_OF_POWER: 'emergency.recent.lossOfPowerTitle', OVERHEATING_BEFORE: 'emergency.recent.overheatTitle',
    UNUSUAL_NOISE: 'emergency.recent.noiseTitle', SMELL_BEFORE: 'emergency.recent.smellTitle',
    NO_SIGNS: 'emergency.recent.noSignsTitle' } },
  { field: 'Q2b_running_issue', prompt: 'emergency.runningIssue.prompt', options: {
    OVERHEATING: 'emergency.runningIssue.overheatingTitle', NOISE: 'emergency.runningIssue.noiseTitle',
    NO_POWER: 'emergency.runningIssue.noPowerTitle', SMOKE: 'emergency.runningIssue.smokeTitle',
    STALLING: 'emergency.runningIssue.stallingTitle' } },
  { field: 'Q6_smells', prompt: 'emergency.smells.prompt', options: {
    BURNING_ELECTRICAL: 'emergency.smells.electricalTitle', BURNING_OIL: 'emergency.smells.oilTitle',
    FUEL_SMELL: 'emergency.smells.fuelTitle', ROTTEN_EGGS: 'emergency.smells.sulfurTitle',
    SWEET: 'emergency.smells.sweetTitle', NO_SMELL: 'emergency.smells.noneTitle' } },
  { field: 'Q3_sound', prompt: 'emergency.sound.prompt', options: {
    RAPID_CLICKING: 'emergency.sound.rapidClicking', NORMAL_CRANKING: 'emergency.sound.normalCranking',
    GRINDING: 'emergency.sound.grinding', NOTHING: 'emergency.sound.nothing' } },
  { field: 'Q3b_electrical', prompt: 'emergency.electrical.prompt', options: {
    ALL_DEAD_NO_LIGHTS: 'emergency.electrical.allDeadTitle', DIM_LIGHTS: 'emergency.electrical.dimTitle',
    SOME_LIGHTS_ON: 'emergency.electrical.someNormalTitle' } },
  { field: 'Q7_overheat_detail', prompt: 'emergency.overheatDetail.prompt', options: {
    TRAFFIC_ONLY: 'emergency.overheatDetail.trafficTitle', ALWAYS: 'emergency.overheatDetail.alwaysTitle',
    HILL_CLIMB: 'emergency.overheatDetail.hillClimbTitle', WITH_AC: 'emergency.overheatDetail.withAcTitle' } },
  { field: 'Q4_noise_detail', prompt: 'emergency.noiseDetail.prompt', options: {
    SQUEAL: 'emergency.noiseDetail.squealTitle', KNOCK: 'emergency.noiseDetail.knockTitle',
    GRIND: 'emergency.noiseDetail.grindTitle', WHINE: 'emergency.noiseDetail.whineTitle',
    CLUNK: 'emergency.noiseDetail.clunkTitle' } },
  { field: 'Q8_smoke_color', prompt: 'emergency.smokeColor.prompt', options: {
    WHITE: 'emergency.smokeColor.whiteTitle', BLUE_GREY: 'emergency.smokeColor.blueGreyTitle',
    BLACK: 'emergency.smokeColor.blackTitle', ELECTRICAL_BURNING: 'emergency.smokeColor.electricalTitle' } },
  { field: 'Q_brake_detail', prompt: 'emergency.brakeDetail.prompt', options: {
    SQUEALING: 'emergency.brakeDetail.squealingTitle', GRINDING: 'emergency.brakeDetail.grindingTitle',
    PULL_ONE_SIDE: 'emergency.brakeDetail.pullTitle', SOFT_PEDAL: 'emergency.brakeDetail.softPedalTitle' } },
  { field: 'Q_gear_detail', prompt: 'emergency.gearDetail.prompt', options: {
    SLIPPING: 'emergency.gearDetail.slippingTitle', WONT_ENGAGE: 'emergency.gearDetail.wontEngageTitle',
    GRINDING: 'emergency.gearDetail.grindingTitle', CLUTCH_SOFT: 'emergency.gearDetail.clutchSoftTitle' } },
  // Context: strings still in the mobile locale; the screen was removed and mobile
  // now sends defaults (kaduna-web /report still asks these).
  { field: 'recent_rain', prompt: 'emergency.context.fieldRain', options: {
    NONE: 'emergency.context.rainNone', YESTERDAY: 'emergency.context.rainYesterday',
    WITHIN_3_DAYS: 'emergency.context.rainThreeDays', MONSOON: 'emergency.context.rainMonsoon' } },
  { field: 'parked_overnight', prompt: 'emergency.context.fieldParked', options: {
    INDOOR: 'emergency.context.parkIndoor', OUTDOOR: 'emergency.context.parkOutdoor' } },
  { field: 'last_fueled', prompt: 'emergency.context.fieldFuel', options: {
    TODAY_NEW_STATION: 'emergency.context.fuelTodayNew', TODAY_USUAL: 'emergency.context.fuelTodayUsual',
    WITHIN_WEEK: 'emergency.context.fuelWithinWeek', OVER_WEEK: 'emergency.context.fuelOverWeek' } },
];
const NO_LIGHTS = 'None (no lights tapped)'; // mobile has no "none" tile; empty selection sends NONE

const SERVICE_LABEL_KEY = (st: string) =>
  'common.serviceType.' + st.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const PROVIDER_LABEL_KEY = (pt: string) =>
  'common.providerType.' + pt.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// ── CSV (quoted fields with "" escapes) ──
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const ENGINE_INTENTS = ['WONT_START', 'ENGINE_PROBLEM', 'WEIRD_BEHAVIOR'];
const MOBILE_LAMPS = new Set(['CHECK_ENGINE', 'OIL', 'BATTERY', 'BRAKE', 'ABS', 'SERVICE', 'TIRE_PRESSURE', 'TEMPERATURE']);

/** True when the row answers exactly the questions the mobile flow would show (lib/emergencyFlow.ts). */
function followsMobileFlow(r: Record<string, string>): boolean {
  const q2 = r.Q2_engine_start, q2b = r.Q2b_running_issue, q1 = r.Q1_intent;
  const asked: Record<string, boolean> = {
    Q2_engine_start: ENGINE_INTENTS.includes(q1),
    Q2b_running_issue: q2 === 'STARTS_NORMAL' || q2 === 'STARTS_BUT_ISSUE',
    Q3_sound: q2 === 'CRANKS_NO_START', Q3b_electrical: q2 === 'NO_CRANK',
    Q7_overheat_detail: q2b === 'OVERHEATING', Q4_noise_detail: q2b === 'NOISE', Q8_smoke_color: q2b === 'SMOKE',
    Q_brake_detail: q1 === 'BRAKE_ISSUE', Q_gear_detail: q1 === 'GEAR_ISSUE',
  };
  for (const [f, want] of Object.entries(asked)) if ((r[f] !== NA) !== want) return false;
  for (const q of QUESTIONS) {
    if (q.field === 'Q5_lights' || q.field === 'Q9_recent') continue;
    if (r[q.field] !== NA && !(r[q.field] in q.options)) return false; // option the app can't show
  }
  const lights: string[] = JSON.parse(r.Q5_lights), recent: string[] = JSON.parse(r.Q9_recent);
  if (lights.includes('NONE') ? lights.length > 1 : !lights.every((l) => MOBILE_LAMPS.has(l))) return false;
  if (recent.includes('NO_SIGNS') && recent.length > 1) return false;
  return true;
}

function informativeness(r: Record<string, string>): number {
  const lights: string[] = JSON.parse(r.Q5_lights), recent: string[] = JSON.parse(r.Q9_recent);
  return QUESTIONS.filter((q) => !['Q5_lights', 'Q9_recent', 'Q6_smells', 'recent_rain', 'parked_overnight', 'last_fueled'].includes(q.field)
      && r[q.field] !== NA).length
    + lights.filter((l) => l !== 'NONE').length
    + recent.filter((s) => s !== 'NO_SIGNS').length
    + (r.Q6_smells !== 'NO_SMELL' ? 1 : 0);
}

function toResponses(r: Record<string, string>, context?: Record<string, string>) {
  return {
    Q1_intent: r.Q1_intent, Q2_engine_start: r.Q2_engine_start, Q2b_running_issue: r.Q2b_running_issue,
    Q3_sound: r.Q3_sound, Q3b_electrical: r.Q3b_electrical, Q4_noise_detail: r.Q4_noise_detail,
    Q7_overheat_detail: r.Q7_overheat_detail, Q8_smoke_color: r.Q8_smoke_color,
    Q_brake_detail: r.Q_brake_detail, Q_gear_detail: r.Q_gear_detail, Q6_smells: r.Q6_smells,
    Q5_lights: JSON.parse(r.Q5_lights), Q9_recent: JSON.parse(r.Q9_recent),
    // Not in the dataset and not split on by the v3 tree; mobile's DEFAULT_SL_CONTEXT values.
    location_type: 'URBAN', vehicle_age_bucket: '8_15',
    recent_rain: r.recent_rain, parked_overnight: r.parked_overnight, last_fueled: r.last_fueled,
    ...context,
  } as any;
}

function renderAnswers(r: Record<string, string>) {
  const out: { question: string; answer: string }[] = [];
  for (const q of QUESTIONS) {
    const v = r[q.field];
    if (v === NA) continue;
    let answer: string;
    if (q.field === 'Q5_lights' || q.field === 'Q9_recent') {
      const vals = (JSON.parse(v) as string[]).filter((x) => x !== 'NONE');
      answer = vals.length ? vals.map((x) => t(q.options[x])).join(', ') : NO_LIGHTS;
    } else answer = t(q.options[v]);
    out.push({ question: t(q.prompt), answer });
  }
  return out;
}

async function main() {
  // Set before the service modules load: dotenv never overrides an existing var,
  // so this keeps the Maps key out (Haversine ETA, no network) and logs quiet.
  process.env.GOOGLE_MAPS_API_KEY = '';
  process.env.LOG_LEVEL ??= 'error';
  const { runTriageEngine } = await import('../src/services/triage-engine');
  const { runDispatchOptimizer } = await import('../src/services/dispatch-optimizer');
  const { argmaxServiceType } = await import('../src/services/bayesian-engine');
  const { getProviderCapabilities } = await import('../src/constants/capability-matrix');
  const { PROVIDER_TYPES } = await import('../src/types');

  // One provider of each type, equidistant from the incident, schema-default trust
  // (0.75), registration-default capabilities, platform-default service times.
  // A synthetic fleet: live dispatch also depends on real distance and trust.
  const incident = { latitude: 6.9271, longitude: 79.8612 };
  const fleet = PROVIDER_TYPES.map((type) => ({
    id: type, name: type, type, latitude: incident.latitude + 0.01, longitude: incident.longitude,
    capabilities: getProviderCapabilities(type), trustScore: 0.75,
  }));

  /** Mirrors dispatch-executor.ts: hard capability gate on the argmax, then ECM. */
  async function dispatchFor(probabilities: any) {
    const predicted = argmaxServiceType(probabilities).serviceType;
    const eligible = fleet.filter((p) => p.capabilities.includes(predicted));
    if (!eligible.length) return { provider_type_code: 'NO_PROVIDER', provider_type_label: 'No capable provider (escalated)', eligible: [] };
    const res = await runDispatchOptimizer(eligible, incident, probabilities, 5);
    const top = res.rankedProviders[0];
    const tied = res.rankedProviders.filter((p) => p.expectedCost === top.expectedCost).map((p) => p.provider.type);
    return {
      provider_type_code: top.provider.type,
      provider_type_label: t(PROVIDER_LABEL_KEY(top.provider.type)),
      eligible: eligible.map((p) => p.type),
      tied_with: tied.length > 1 ? tied.filter((x) => x !== top.provider.type) : undefined,
    };
  }

  const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
  const scenarios: any[] = [];
  const summary: string[][] = [];

  for (const [i, target] of TARGETS.entries()) {
    const candidates = rows.map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.source === 'real' && r.service_type === target && followsMobileFlow(r));
    if (!candidates.length) throw new Error(`no usable real row for ${target}`);
    const { r, idx } = candidates.reduce((best, c) => (informativeness(c.r) > informativeness(best.r) ? c : best));

    const tri = runTriageEngine(toResponses(r));
    const ranked = Object.entries(tri.probabilities).filter(([, p]) => p > 0).sort(([, a], [, b]) => b - a);
    const dispatch = await dispatchFor(tri.probabilities);

    // What the shipped mobile app would actually send: it no longer asks context.
    const triMobile = runTriageEngine(toResponses(r, { recent_rain: 'NONE', parked_overnight: 'OUTDOOR', last_fueled: 'WITHIN_WEEK' }));

    const pred = tri.predictedServiceType;
    scenarios.push({
      id: `F${i + 1}`,
      dataset_row: idx + 2, // 1-based CSV line (header = line 1)
      answers: renderAnswers(r),
      vehicle: { make: r.vehicle_make, fuel_type: r.fuel_type },
      engine_prediction: {
        service_type_code: pred,
        service_type_label: t(SERVICE_LABEL_KEY(pred)),
        confidence: +tri.confidence.toFixed(2),
        top_probability: +ranked[0][1].toFixed(2),
        alternatives: ranked.slice(1, 3).map(([st, p]) => ({
          service_type_code: st, service_type_label: t(SERVICE_LABEL_KEY(st)), probability: +p.toFixed(2),
        })),
      },
      dispatch: {
        provider_type_code: dispatch.provider_type_code,
        provider_type_label: dispatch.provider_type_label,
        // Equal expected cost: the code has no type preference here, the nearest provider wins.
        ...(dispatch.tied_with ? { equal_cost_alternatives: dispatch.tied_with } : {}),
      },
      dataset_label: r.service_type,
    });
    summary.push([`F${i + 1}`, String(idx + 2), pred, tri.confidence.toFixed(2), dispatch.provider_type_code,
      (dispatch as any).tied_with ? `tie:${(dispatch as any).tied_with.join('/')}` : '',
      r.service_type, pred === r.service_type ? 'yes' : 'no',
      triMobile.predictedServiceType === pred ? '' : `mobile-defaults→${triMobile.predictedServiceType}`]);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(scenarios, null, 2) + '\n');
  console.table(summary.map(([id, row, pred, conf, prov, tie, label, match, mob]) => ({ id, row, pred, conf, prov, tie, label, match, mob })));
  console.log(`correct: ${summary.filter((s) => s[7] === 'yes').length}/${summary.length}  →  ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
