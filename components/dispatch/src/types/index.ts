/**
 * ============================================================================
 * UADO Framework — Core Type Definitions
 * ============================================================================
 *
 * Central type definitions for the Uncertainty-Aware Dispatch Optimization
 * framework. Service types, provider types, lifecycle states, and triage
 * interfaces all live here.
 *
 * @module types
 * @author Janukshan Sivakumar - IT22635266
 */

// ─────────────────────────────────────────────────────────────────────────
// Service Types — what kind of help is needed?
// ─────────────────────────────────────────────────────────────────────────
//
// The catalog is split into two cohorts:
//
//   - ML_SERVICE_TYPES (19 classes) — diagnosed by the trained decision
//     tree from questionnaire (+ optional OBD) inputs. These are the
//     genuinely ambiguous cases where the driver doesn't know what's wrong.
//
//   - FAST_PATH_SERVICE_TYPES (10 classes) — selected directly by the driver
//     in the Q1 intent picker. No ML inference; deterministic dispatch.
//
// The combined SERVICE_TYPES tuple is used everywhere downstream (capability
// matrix, ECM probability distributions, etc.).
// ─────────────────────────────────────────────────────────────────────────

/** 19 service types diagnosed by the ML decision tree. */
export const ML_SERVICE_TYPES = [
  // Battery & charging
  'BATTERY_JUMP', 'BATTERY_TERMINAL_CLEAN', 'BATTERY_REPLACE', 'ALTERNATOR_ISSUE',
  // Starting
  'STARTER_MOTOR',
  // Cooling
  'COOLANT_LOW', 'RADIATOR_FAN_ISSUE', 'RADIATOR_HOSE_LEAK', 'ENGINE_OVERHEAT_SEVERE',
  // Belts
  'BELT_BROKEN',
  // Fuel & ignition
  'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM',
  // Electrical
  'ELECTRICAL_FAULT_RAIN',
  // Brakes
  'BRAKE_PAD_WORN', 'BRAKE_FAILURE',
  // Drivetrain
  'CLUTCH_WORN', 'TRANSMISSION_ISSUE',
  // Severe / tow-required
  'SEVERE_MECHANICAL_TOW',
] as const;

export type MLServiceType = typeof ML_SERVICE_TYPES[number];

/** 10 fast-path service types selected directly by the driver in Q1. */
export const FAST_PATH_SERVICE_TYPES = [
  'LOCKOUT', 'KEY_LOST',
  'FLAT_TIRE_CHANGE',
  'FUEL_EMPTY', 'FUEL_WRONG',
  'LIGHT_BULB', 'BLOWN_FUSE',
  'MAJOR_ACCIDENT',
  'URGENT_TOW',          // fuel leak / electrical fire / immediate safety
  'FLOOD_RECOVERY',      // landslide / flood / ditch recovery
] as const;

export type FastPathServiceType = typeof FAST_PATH_SERVICE_TYPES[number];

/**
 * Combined catalog (29 entries). Listed explicitly to preserve the const
 * tuple type for downstream `typeof[number]` derivations.
 */
export const SERVICE_TYPES = [
  // ML
  'BATTERY_JUMP', 'BATTERY_TERMINAL_CLEAN', 'BATTERY_REPLACE', 'ALTERNATOR_ISSUE',
  'STARTER_MOTOR',
  'COOLANT_LOW', 'RADIATOR_FAN_ISSUE', 'RADIATOR_HOSE_LEAK', 'ENGINE_OVERHEAT_SEVERE',
  'BELT_BROKEN',
  'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM',
  'ELECTRICAL_FAULT_RAIN',
  'BRAKE_PAD_WORN', 'BRAKE_FAILURE',
  'CLUTCH_WORN', 'TRANSMISSION_ISSUE',
  'SEVERE_MECHANICAL_TOW',
  // Fast-path
  'LOCKOUT', 'KEY_LOST',
  'FLAT_TIRE_CHANGE',
  'FUEL_EMPTY', 'FUEL_WRONG',
  'LIGHT_BULB', 'BLOWN_FUSE',
  'MAJOR_ACCIDENT',
  'URGENT_TOW',
  'FLOOD_RECOVERY',
] as const;

export type ServiceType = typeof SERVICE_TYPES[number];

// ─────────────────────────────────────────────────────────────────────────
// Provider Types
// ─────────────────────────────────────────────────────────────────────────

export const PROVIDER_TYPES = [
  'MOBILE_MECHANIC',
  'FUEL_DELIVERY',
  'LOCKSMITH',
  'TOW_LIGHT',
  'TOW_HEAVY',
] as const;

export type ProviderType = typeof PROVIDER_TYPES[number];

// ─────────────────────────────────────────────────────────────────────────
// Incident lifecycle
// ─────────────────────────────────────────────────────────────────────────

export const INCIDENT_STATUSES = [
  'CREATED', 'TRIAGING', 'DISPATCHING', 'PROVIDER_ASSIGNED',
  'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'ESCALATED', 'CANCELLED',
] as const;

export type IncidentStatus = typeof INCIDENT_STATUSES[number];

// ─────────────────────────────────────────────────────────────────────────
// Triage Engine — tier, output, and the adaptive questionnaire shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * Triage tier determines the data sources used for diagnosis.
 *   QUESTIONNAIRE_ONLY: questionnaire only, no OBD, no priors  (Tier 1)
 *   OBD_ENHANCED:       questionnaire + OBD-II telemetry        (Tier 2)
 *   BAYESIAN_LEARNED:   either tier above, refined by Bayesian priors (Tier 3)
 */
export type TriageTier = 'QUESTIONNAIRE_ONLY' | 'OBD_ENHANCED' | 'BAYESIAN_LEARNED';

/** Probability distribution over service types. Sums to 1.0. */
export type ServiceTypeProbabilities = Record<ServiceType, number>;

/** Sentinel value used by adaptive form fields the user wasn't asked. */
export const NOT_ASKED = 'NOT_ASKED' as const;
export type NotAsked = typeof NOT_ASKED;

/** Helper: makes any string-literal type include the NOT_ASKED sentinel. */
export type Adaptive<T extends string> = T | NotAsked;

// ── Q1 intent picker ────────────────────────────────────────────────────
// Both cohorts of answers live here. Fast-path answers cause the front-end
// to short-circuit ML and dispatch directly; ML-engaging answers continue
// down the adaptive form.

export const Q1_ML_INTENTS     = ['WONT_START', 'ENGINE_PROBLEM', 'WEIRD_BEHAVIOR',
                                  'BRAKE_ISSUE', 'GEAR_ISSUE'] as const;
export const Q1_FAST_INTENTS   = ['LOCKOUT', 'FLAT_TIRE', 'FUEL_EMPTY', 'FUEL_WRONG',
                                  'MAJOR_CRASH', 'FUEL_LEAK_FIRE_RISK', 'LIGHT_BULB',
                                  'BLOWN_FUSE', 'KEY_LOST', 'STUCK_FLOOD'] as const;

export type Q1MLIntent   = typeof Q1_ML_INTENTS[number];
export type Q1FastIntent = typeof Q1_FAST_INTENTS[number];
export type Q1Intent     = Q1MLIntent | Q1FastIntent;

// ── Adaptive single-select questions ────────────────────────────────────

export type Q2EngineStart    = Adaptive<'STARTS_NORMAL' | 'STARTS_BUT_ISSUE' |
                                        'CRANKS_NO_START' | 'NO_CRANK'>;
export type Q2bRunningIssue  = Adaptive<'OVERHEATING' | 'NOISE' | 'NO_POWER' |
                                        'SMOKE' | 'STALLING'>;
export type Q3Sound          = Adaptive<'RAPID_CLICKING' | 'SINGLE_CLICK' |
                                        'NORMAL_CRANKING' | 'GRINDING' |
                                        'NOTHING' | 'WHIRRING'>;
export type Q3bElectrical    = Adaptive<'ALL_DEAD_NO_LIGHTS' | 'DIM_LIGHTS' |
                                        'SOME_LIGHTS_ON'>;
export type Q4NoiseDetail    = Adaptive<'SQUEAL' | 'KNOCK' | 'GRIND' |
                                        'WHINE' | 'CLUNK'>;
export type Q7OverheatDetail = Adaptive<'TRAFFIC_ONLY' | 'ALWAYS' |
                                        'HILL_CLIMB' | 'WITH_AC'>;
export type Q8SmokeColor     = Adaptive<'WHITE' | 'BLUE_GREY' | 'BLACK' |
                                        'ELECTRICAL_BURNING'>;
export type QBrakeDetail     = Adaptive<'SQUEALING' | 'GRINDING' |
                                        'PULL_ONE_SIDE' | 'SOFT_PEDAL'>;
export type QGearDetail      = Adaptive<'SLIPPING' | 'WONT_ENGAGE' |
                                        'GRINDING' | 'CLUTCH_SOFT'>;
export type Q6Smells         = 'BURNING_ELECTRICAL' | 'BURNING_OIL' | 'FUEL_SMELL' |
                               'ROTTEN_EGGS' | 'SWEET' | 'NO_SMELL';

// ── Multi-select tail questions ─────────────────────────────────────────

export const DASHBOARD_LAMPS = [
  'BATTERY', 'CHECK_ENGINE', 'OIL', 'TEMPERATURE',
  'ABS', 'BRAKE', 'TIRE_PRESSURE', 'SERVICE', 'GLOW_PLUG', 'NONE',
] as const;
export type DashboardLamp = typeof DASHBOARD_LAMPS[number];

export const RECENT_WARNINGS = [
  'HARD_START', 'LIGHTS_FLICKER', 'LOSS_OF_POWER',
  'OVERHEATING_BEFORE', 'UNUSUAL_NOISE', 'SMELL_BEFORE', 'NO_SIGNS',
] as const;
export type RecentWarning = typeof RECENT_WARNINGS[number];

// ── Sri Lankan context features ─────────────────────────────────────────

export type LocationType    = 'COASTAL' | 'HILL' | 'URBAN' | 'RURAL';
export type RecentRain      = 'NONE' | 'YESTERDAY' | 'WITHIN_3_DAYS' | 'MONSOON';
export type ParkedOvernight = 'INDOOR' | 'OUTDOOR';
export type VehicleAgeBucket = 'UNDER_3' | '3_7' | '8_15' | 'OVER_15';
export type LastFueled       = 'TODAY_NEW_STATION' | 'TODAY_USUAL' |
                               'WITHIN_WEEK' | 'OVER_WEEK';

/**
 * Adaptive triage questionnaire response.
 *
 * Single-select questions on a non-traversed branch carry the literal
 * "NOT_ASKED" — the decision tree was trained with this encoding and treats
 * NOT_ASKED as its own categorical value.
 */
export interface TriageResponses {
  // Q1 intent picker
  Q1_intent:           Q1Intent;

  // Adaptive single-selects
  Q2_engine_start:     Q2EngineStart;
  Q2b_running_issue:   Q2bRunningIssue;
  Q3_sound:            Q3Sound;
  Q3b_electrical:      Q3bElectrical;
  Q4_noise_detail:     Q4NoiseDetail;
  Q7_overheat_detail:  Q7OverheatDetail;
  Q8_smoke_color:      Q8SmokeColor;
  Q_brake_detail:      QBrakeDetail;
  Q_gear_detail:       QGearDetail;
  Q6_smells:           Q6Smells;

  // Always-asked multi-select tail
  Q5_lights:           DashboardLamp[];
  Q9_recent:           RecentWarning[];

  // Sri Lankan context (always asked)
  location_type:       LocationType;
  recent_rain:         RecentRain;
  parked_overnight:    ParkedOvernight;
  vehicle_age_bucket:  VehicleAgeBucket;
  last_fueled:         LastFueled;
}

/** Output of the triage engine — same shape across all three tiers. */
export interface TriageResult {
  probabilities:        ServiceTypeProbabilities;
  predictedServiceType: ServiceType;
  confidence:           number;
  tier:                 TriageTier;
  entropy:              number;
  obdDataUsed:          boolean;
  bayesianPriorsApplied:boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// OBD-II vehicle telemetry
// ─────────────────────────────────────────────────────────────────────────

/**
 * OBD-II telemetry retrieved from the Predictive Maintenance component.
 * Field names match the synthetic_telemetry_data.csv schema we trained on.
 */
export interface OBDData {
  battery_voltage_v?:       number;
  battery_temp_c?:          number;
  battery_charge_percent?:  number;
  battery_health_percent?:  number;
  alternator_output_v?:     number;
  engine_temp_c?:           number;
  coolant_temp_c?:          number;
  engine_rpm?:              number;
  oil_pressure_psi?:        number;
  fuel_level_percent?:      number;
  engine_load_percent?:     number;
  ambient_temp_c?:          number;
  brake_fluid_level_psi?:   number;
  brake_pad_wear_mm?:       number;
  brake_temp_c?:            number;

  faultCodes?:        string[];
  predictiveAlerts?:  string[];
  available:          boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Provider & Dispatch
// ─────────────────────────────────────────────────────────────────────────

export interface Location {
  latitude:  number;
  longitude: number;
}

export type ProviderStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';

export interface Provider {
  id:           string;
  name:         string;
  type:         ProviderType;
  location:     Location;
  capabilities: ServiceType[];
  trustScore:   number;
  status:       ProviderStatus;
  phone?:       string;
  vehiclePlate?: string;
}

export interface DispatchResult {
  rankedProviders:   RankedProvider[];
  selectedProvider:  RankedProvider;
  computationTimeMs: number;
  trafficImpactScore:number;
  lambda:            number;
}

export interface RankedProvider {
  provider:                Provider;
  expectedCost:            number;
  rank:                    number;
  estimatedTravelTimeMin:  number;
  estimatedServiceTimeMin: number;
  mismatchRisk:            number;
  costBreakdown:           CostBreakdown;
}

export interface CostBreakdown {
  expectedServiceCost:    number;
  expectedMismatchCost:   number;
  trafficExternalityCost: number;
  trustAdjustment:        number;
  totalCost:              number;
}

// ─────────────────────────────────────────────────────────────────────────
// Incident
// ─────────────────────────────────────────────────────────────────────────

export interface Incident {
  id:                  string;
  status:              IncidentStatus;
  location:            Location;
  vehicleInfo:         VehicleInfo;
  triageResponses?:    TriageResponses;
  triageResult?:       TriageResult;
  obdData?:            OBDData;
  dispatchResult?:     DispatchResult;
  assignedProviderId?: string;
  createdAt:           Date;
  updatedAt:           Date;
  resolvedAt?:         Date;
}

export interface VehicleInfo {
  make?:               string;
  model?:              string;
  year?:               number;
  fuelType?:           'PETROL' | 'DIESEL' | 'HYBRID' | 'ELECTRIC';
  registrationNumber?: string;
  hasOBD?:             boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Bayesian learning
// ─────────────────────────────────────────────────────────────────────────

export interface ResolutionFeedback {
  incidentId:             string;
  predictedDistribution:  ServiceTypeProbabilities;
  predictedServiceType:   ServiceType;
  predictedConfidence:    number;
  actualServiceType:      ServiceType;
  wasMatch:               boolean;
  resolutionTimeMinutes:  number;
  reDispatches:           number;
  userRating?:            number;
  providerNotes?:         string;
  timestamp:              Date;
}

export interface BayesianPrior {
  symptomKey:          string;
  probabilities:       ServiceTypeProbabilities;
  observationCount:    number;
  currentLearningRate: number;
  updatedAt:           Date;
}

// ─────────────────────────────────────────────────────────────────────────
// API request/response shapes
// ─────────────────────────────────────────────────────────────────────────

export interface CreateIncidentRequest {
  location:    Location;
  vehicleInfo?: VehicleInfo;
  description?: string;
}

export interface SubmitTriageRequest {
  incidentId: string;
  responses:  TriageResponses;
  obdData?:   OBDData;
}

export interface DispatchRequest {
  incidentId:          string;
  trafficImpactScore?: number;
  maxProviders?:       number;
}

export interface ProviderResponse {
  incidentId:    string;
  providerId:    string;
  accepted:      boolean;
  declineReason?: string;
}

export interface ResolutionReport {
  incidentId:             string;
  providerId:             string;
  actualServiceType:      ServiceType;
  resolutionTimeMinutes:  number;
  notes?:                 string;
  escalationNeeded?:      boolean;
}

export interface ApiResponse<T> {
  success:   boolean;
  data?:     T;
  error?:    string;
  message?:  string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — fast-path detection
// ─────────────────────────────────────────────────────────────────────────

export function isMLIntent(intent: Q1Intent): intent is Q1MLIntent {
  return (Q1_ML_INTENTS as readonly string[]).includes(intent);
}

export function isFastPathIntent(intent: Q1Intent): intent is Q1FastIntent {
  return (Q1_FAST_INTENTS as readonly string[]).includes(intent);
}

/** Map a Q1 fast-path intent to its corresponding ServiceType. */
export const FAST_PATH_INTENT_TO_SERVICE: Record<Q1FastIntent, ServiceType> = {
  LOCKOUT:             'LOCKOUT',
  KEY_LOST:            'KEY_LOST',
  FLAT_TIRE:           'FLAT_TIRE_CHANGE',
  FUEL_EMPTY:          'FUEL_EMPTY',
  FUEL_WRONG:          'FUEL_WRONG',
  MAJOR_CRASH:         'MAJOR_ACCIDENT',
  FUEL_LEAK_FIRE_RISK: 'URGENT_TOW',
  LIGHT_BULB:          'LIGHT_BULB',
  BLOWN_FUSE:          'BLOWN_FUSE',
  STUCK_FLOOD:         'FLOOD_RECOVERY',
};
