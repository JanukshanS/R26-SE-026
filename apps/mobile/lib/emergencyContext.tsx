/**
 * ============================================================================
 * Emergency Flow Context — shared state across (emergency)/* screens
 * ============================================================================
 *
 * Holds the user's progressive answers as they walk through safety-check ->
 * diagnosis-sound -> diagnosis-lights, plus the eventual triage + dispatch
 * results. Avoids prop-drilling and survives back-navigation within the
 * emergency stack.
 *
 * Why React Context (not Zustand/Redux):
 *   - Scope is small and entirely confined to the emergency stack
 *   - No persistence needed across app restarts (a fresh emergency = fresh state)
 *   - Mobile package.json keeps zero state-mgmt deps
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type {
  DispatchResultData,
  ServiceType,
  TriageResult,
  TriageResponses,
} from "./dispatchApi";

// ─────────────────────────────────────────────────────────────────────────
// User selections collected as they walk through the form
// ─────────────────────────────────────────────────────────────────────────

export type DamageChoice = "CRASH" | "MINOR" | "NONE" | null;

/** Mobile sound option ids → backend Q3_sound enum values. */
export type MobileSoundId = "RAPID_CLICKING" | "NORMAL_CRANKING" | "GRINDING" | "NOTHING";

/** Backend Q2_engine_start enum values. */
export type EngineStateChoice =
  | "STARTS_NORMAL" | "STARTS_BUT_ISSUE" | "CRANKS_NO_START" | "NO_CRANK"
  | null;

/** Backend Q6_smells enum values. */
export type SmellChoice =
  | "BURNING_ELECTRICAL" | "BURNING_OIL" | "FUEL_SMELL"
  | "ROTTEN_EGGS" | "SWEET" | "NO_SMELL"
  | null;

/** Backend Q9_recent — multi-select of warning signs. */
export type RecentSign =
  | "HARD_START" | "LIGHTS_FLICKER" | "LOSS_OF_POWER"
  | "OVERHEATING_BEFORE" | "UNUSUAL_NOISE" | "SMELL_BEFORE" | "NO_SIGNS";

/**
 * Top-level problem cohort selected on the intent picker (the screen right
 * after safety-check). Drives which deep-dive branch the adaptive form
 * takes — engine paths vs brake paths vs gear paths.
 */
export type IntentCohort = "ENGINE" | "BRAKE" | "GEAR" | null;

/** Backend Q2b_running_issue enum values (asked when engine starts but runs poorly). */
export type RunningIssueChoice =
  | "OVERHEATING" | "NOISE" | "NO_POWER" | "SMOKE" | "STALLING"
  | null;

/** Backend Q7_overheat_detail enum values (asked when running-issue = OVERHEATING). */
export type OverheatChoice =
  | "TRAFFIC_ONLY" | "ALWAYS" | "HILL_CLIMB" | "WITH_AC"
  | null;

/** Backend Q4_noise_detail enum values (asked when running-issue = NOISE). */
export type NoiseChoice =
  | "SQUEAL" | "KNOCK" | "GRIND" | "WHINE" | "CLUNK"
  | null;

/** Backend Q8_smoke_color enum values (asked when running-issue = SMOKE). */
export type SmokeColorChoice =
  | "WHITE" | "BLUE_GREY" | "BLACK" | "ELECTRICAL_BURNING"
  | null;

/** Backend Q3b_electrical enum values (asked when engine-state = NO_CRANK). */
export type ElectricalChoice =
  | "ALL_DEAD_NO_LIGHTS" | "DIM_LIGHTS" | "SOME_LIGHTS_ON"
  | null;

/** Backend Q_brake_detail enum values (asked when intent = BRAKE). */
export type BrakeDetailChoice =
  | "SQUEALING" | "GRINDING" | "PULL_ONE_SIDE" | "SOFT_PEDAL"
  | null;

/** Backend Q_gear_detail enum values (asked when intent = GEAR). */
export type GearDetailChoice =
  | "SLIPPING" | "WONT_ENGAGE" | "GRINDING" | "CLUTCH_SOFT"
  | null;

/** Sri Lankan context features (5 short questions). */
export interface SLContext {
  location_type:      "COASTAL" | "HILL" | "URBAN" | "RURAL";
  recent_rain:        "NONE" | "YESTERDAY" | "WITHIN_3_DAYS" | "MONSOON";
  parked_overnight:   "INDOOR" | "OUTDOOR";
  vehicle_age_bucket: "UNDER_3" | "3_7" | "8_15" | "OVER_15";
  last_fueled:        "TODAY_NEW_STATION" | "TODAY_USUAL" | "WITHIN_WEEK" | "OVER_WEEK";
}

/** Mobile dashboard-lamp ids → backend Q5_lights enum values. */
export const LIGHT_ID_TO_BACKEND: Record<string, string> = {
  engine:  "CHECK_ENGINE",
  oil:     "OIL",
  battery: "BATTERY",
  brake:   "BRAKE",
  abs:     "ABS",
  fuel:    "SERVICE",        // closest analog — fuel-related "service" indicator
  tyre:    "TIRE_PRESSURE",
  temp:    "TEMPERATURE",
  other:   "SERVICE",
};

export interface EmergencyState {
  damage:       DamageChoice;
  sound:        MobileSoundId | null;
  mobileLights: Set<string>;           // mobile-side ids (engine, oil, ...)

  // Adaptive form selections
  intent:        IntentCohort;          // top-level branch (Engine/Brake/Gear)
  engineState:   EngineStateChoice;     // Q2
  runningIssue:  RunningIssueChoice;    // Q2b (when STARTS_*)
  overheatDetail:OverheatChoice;        // Q7 (when running = OVERHEATING)
  noiseDetail:   NoiseChoice;           // Q4 (when running = NOISE)
  smokeColor:    SmokeColorChoice;      // Q8 (when running = SMOKE)
  electrical:    ElectricalChoice;      // Q3b (when engine = NO_CRANK)
  brakeDetail:   BrakeDetailChoice;     // Q_brake (when intent = BRAKE)
  gearDetail:    GearDetailChoice;      // Q_gear (when intent = GEAR)
  smells:        SmellChoice;           // Q6 (tail)
  recentSigns:   Set<RecentSign>;       // Q9 (tail)
  slContext:     SLContext;             // SL context (tail)

  // API results
  incidentId:     string | null;
  triageResult:   TriageResult | null;
  dispatchResult: DispatchResultData | null;

  // Lifecycle
  loading:    boolean;
  error:      string | null;
}

interface EmergencyContextValue extends EmergencyState {
  setDamage:         (d: DamageChoice) => void;
  setSound:          (s: MobileSoundId | null) => void;
  toggleLight:       (id: string) => void;
  setIntent:         (i: IntentCohort) => void;
  setEngineState:    (s: EngineStateChoice) => void;
  setRunningIssue:   (s: RunningIssueChoice) => void;
  setOverheatDetail: (s: OverheatChoice) => void;
  setNoiseDetail:    (s: NoiseChoice) => void;
  setSmokeColor:     (s: SmokeColorChoice) => void;
  setElectrical:     (s: ElectricalChoice) => void;
  setBrakeDetail:    (s: BrakeDetailChoice) => void;
  setGearDetail:     (s: GearDetailChoice) => void;
  setSmells:         (s: SmellChoice) => void;
  toggleRecentSign:  (s: RecentSign) => void;
  setSLContext:      (patch: Partial<SLContext>) => void;
  setLoading:       (b: boolean) => void;
  setError:         (e: string | null) => void;
  setIncidentId:    (id: string | null) => void;
  setTriageResult:  (r: TriageResult | null) => void;
  setDispatchResult:(r: DispatchResultData | null) => void;
  buildTriageResponses: () => TriageResponses;
  reset:            () => void;
}

const EmergencyContext = createContext<EmergencyContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────
// Mapping helpers — collapse mobile's 3-question UI onto backend's adaptive shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * Derive a coherent TriageResponses payload from what mobile has collected.
 *
 * Strategy:
 *   - damage = CRASH       -> Q1_intent = MAJOR_CRASH (fast-path, the screen
 *                              short-circuits before this is even built)
 *   - damage = NONE        -> Q1_intent = WONT_START (most common case)
 *   - damage = MINOR       -> Q1_intent = ENGINE_PROBLEM
 *
 *   - Q2_engine_start inferred from sound:
 *       NOTHING / RAPID_CLICKING / GRINDING -> NO_CRANK
 *       NORMAL_CRANKING                     -> CRANKS_NO_START
 *
 *   - Q3_sound carries the picked sound directly.
 *
 *   - Q5_lights: mapped mobile ids -> backend lamp enum.
 *
 *   - Everything else (Q2b, Q3b, Q4, Q7, Q8, Q_brake, Q_gear) -> NOT_ASKED.
 *
 *   - SL context defaults for the demo (URBAN/NONE/OUTDOOR/8_15/WITHIN_WEEK);
 *     in production these would come from device sensors / driver profile.
 *
 *   - Q6_smells / Q9_recent get safe defaults (NO_SMELL / [NO_SIGNS]).
 */
function buildResponsesFrom(state: EmergencyState): TriageResponses {
  // ── Q1 intent ────────────────────────────────────────────────────────
  // The intent picker drives the top-level cohort; damage refines it.
  //   - damage = CRASH         → MAJOR_CRASH (fast-path)
  //   - intent = BRAKE         → BRAKE_ISSUE
  //   - intent = GEAR          → GEAR_ISSUE
  //   - intent = ENGINE + damage MINOR → ENGINE_PROBLEM
  //   - intent = ENGINE + damage NONE  → WONT_START
  let Q1_intent: string = "WONT_START";
  if (state.damage === "CRASH") {
    Q1_intent = "MAJOR_CRASH";
  } else if (state.intent === "BRAKE") {
    Q1_intent = "BRAKE_ISSUE";
  } else if (state.intent === "GEAR") {
    Q1_intent = "GEAR_ISSUE";
  } else if (state.damage === "MINOR") {
    Q1_intent = "ENGINE_PROBLEM";
  }

  // ── Q2 engine start ──────────────────────────────────────────────────
  // Prefer the explicit Q2 screen answer; otherwise infer from sound; else
  // NOT_ASKED (e.g. on the BRAKE / GEAR paths where engine isn't asked).
  const Q2_engine_start =
    state.engineState ??
    (state.sound === "NORMAL_CRANKING" ? "CRANKS_NO_START" :
     state.sound                       ? "NO_CRANK" :
                                         "NOT_ASKED");

  const Q3_sound = state.sound ?? "NOT_ASKED";

  const Q5_lights = Array.from(state.mobileLights)
    .map((id) => LIGHT_ID_TO_BACKEND[id])
    .filter((v): v is string => Boolean(v));

  const Q9_recent = state.recentSigns.size
    ? Array.from(state.recentSigns)
    : ["NO_SIGNS"];

  return {
    Q1_intent,
    Q2_engine_start,
    Q2b_running_issue: state.runningIssue   ?? "NOT_ASKED",
    Q3_sound,
    Q3b_electrical:    state.electrical     ?? "NOT_ASKED",
    Q4_noise_detail:   state.noiseDetail    ?? "NOT_ASKED",
    Q7_overheat_detail:state.overheatDetail ?? "NOT_ASKED",
    Q8_smoke_color:    state.smokeColor     ?? "NOT_ASKED",
    Q_brake_detail:    state.brakeDetail    ?? "NOT_ASKED",
    Q_gear_detail:     state.gearDetail     ?? "NOT_ASKED",
    Q6_smells:         state.smells         ?? "NO_SMELL",
    Q5_lights:         Q5_lights.length ? Q5_lights : ["NONE"],
    Q9_recent,
    location_type:     state.slContext.location_type,
    recent_rain:       state.slContext.recent_rain,
    parked_overnight:  state.slContext.parked_overnight,
    vehicle_age_bucket:state.slContext.vehicle_age_bucket,
    last_fueled:       state.slContext.last_fueled,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Provider component + hook
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_SL_CONTEXT: SLContext = {
  location_type:      "URBAN",
  recent_rain:        "NONE",
  parked_overnight:   "OUTDOOR",
  vehicle_age_bucket: "8_15",
  last_fueled:        "WITHIN_WEEK",
};

export function EmergencyProvider({ children }: { children: ReactNode }) {
  const [damage, setDamage] = useState<DamageChoice>(null);
  const [sound, setSound] = useState<MobileSoundId | null>(null);
  const [mobileLights, setMobileLights] = useState<Set<string>>(new Set());
  const [intent, setIntent] = useState<IntentCohort>(null);
  const [engineState, setEngineState] = useState<EngineStateChoice>(null);
  const [runningIssue, setRunningIssue] = useState<RunningIssueChoice>(null);
  const [overheatDetail, setOverheatDetail] = useState<OverheatChoice>(null);
  const [noiseDetail, setNoiseDetail] = useState<NoiseChoice>(null);
  const [smokeColor, setSmokeColor] = useState<SmokeColorChoice>(null);
  const [electrical, setElectrical] = useState<ElectricalChoice>(null);
  const [brakeDetail, setBrakeDetail] = useState<BrakeDetailChoice>(null);
  const [gearDetail, setGearDetail] = useState<GearDetailChoice>(null);
  const [smells, setSmells] = useState<SmellChoice>(null);
  const [recentSigns, setRecentSigns] = useState<Set<RecentSign>>(new Set());
  const [slContext, setSLContextState] = useState<SLContext>(DEFAULT_SL_CONTEXT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResultData | null>(null);

  const toggleLight = useCallback((id: string) => {
    setMobileLights((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRecentSign = useCallback((s: RecentSign) => {
    setRecentSigns((prev) => {
      const next = new Set(prev);
      // "NO_SIGNS" is exclusive — picking it clears the rest, picking another clears NO_SIGNS.
      if (s === "NO_SIGNS") {
        return next.has("NO_SIGNS") ? new Set() : new Set(["NO_SIGNS"]);
      }
      next.delete("NO_SIGNS");
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const setSLContext = useCallback((patch: Partial<SLContext>) => {
    setSLContextState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setDamage(null);
    setSound(null);
    setMobileLights(new Set());
    setIntent(null);
    setEngineState(null);
    setRunningIssue(null);
    setOverheatDetail(null);
    setNoiseDetail(null);
    setSmokeColor(null);
    setElectrical(null);
    setBrakeDetail(null);
    setGearDetail(null);
    setSmells(null);
    setRecentSigns(new Set());
    setSLContextState(DEFAULT_SL_CONTEXT);
    setLoading(false);
    setError(null);
    setIncidentId(null);
    setTriageResult(null);
    setDispatchResult(null);
  }, []);

  const buildTriageResponses = useCallback(
    () => buildResponsesFrom({
      damage, sound, mobileLights,
      intent, engineState, runningIssue, overheatDetail, noiseDetail,
      smokeColor, electrical, brakeDetail, gearDetail,
      smells, recentSigns, slContext,
      incidentId, triageResult, dispatchResult, loading, error,
    }),
    [damage, sound, mobileLights, intent, engineState, runningIssue,
     overheatDetail, noiseDetail, smokeColor, electrical, brakeDetail,
     gearDetail, smells, recentSigns, slContext,
     incidentId, triageResult, dispatchResult, loading, error]
  );

  const value = useMemo<EmergencyContextValue>(
    () => ({
      damage, sound, mobileLights,
      intent, engineState, runningIssue, overheatDetail, noiseDetail,
      smokeColor, electrical, brakeDetail, gearDetail,
      smells, recentSigns, slContext,
      incidentId, triageResult, dispatchResult,
      loading, error,
      setDamage, setSound, toggleLight,
      setIntent, setEngineState, setRunningIssue, setOverheatDetail,
      setNoiseDetail, setSmokeColor, setElectrical, setBrakeDetail, setGearDetail,
      setSmells, toggleRecentSign, setSLContext,
      setLoading, setError,
      setIncidentId, setTriageResult, setDispatchResult,
      buildTriageResponses, reset,
    }),
    [
      damage, sound, mobileLights, intent, engineState, runningIssue,
      overheatDetail, noiseDetail, smokeColor, electrical, brakeDetail,
      gearDetail, smells, recentSigns, slContext,
      incidentId, triageResult, dispatchResult,
      loading, error, toggleLight, toggleRecentSign, setSLContext,
      buildTriageResponses, reset,
    ]
  );

  return (
    <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>
  );
}

export function useEmergency(): EmergencyContextValue {
  const ctx = useContext(EmergencyContext);
  if (!ctx) {
    throw new Error(
      "useEmergency() called outside <EmergencyProvider>. " +
      "Did you forget to wrap (emergency)/_layout.tsx?"
    );
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────
// Demo defaults — hardcoded vehicle + location until profile/GPS are wired
// ─────────────────────────────────────────────────────────────────────────

/**
 * Vehicle info hardcoded for the demo. Matches the existing home screen UI
 * (Toyota Aqua, CBD-3742). Replace with profile-store lookup when auth is wired.
 */
export const DEMO_VEHICLE = {
  make:               "Toyota",
  model:              "Aqua",
  year:               2015,
  fuelType:           "HYBRID" as const,
  registrationNumber: "CBD-3742",
  hasOBD:             true,
};

/**
 * Demo / fallback location — Malabe (matches the home screen caption).
 *
 * Deliberately NOT placed at any seeded provider's coordinate, so distance
 * and ETA come out non-zero even when GPS is unavailable.
 *
 * Real GPS, when granted, is fetched via lib/driverLocation.ts —
 * `getCurrentDriverLocation()`. This export remains for code that hasn't
 * been migrated to the async GPS helper yet, plus as the authoritative
 * fallback when permission is denied or geolocation fails.
 */
export const DEMO_LOCATION = {
  latitude:  6.9147,
  longitude: 79.9724,
};
