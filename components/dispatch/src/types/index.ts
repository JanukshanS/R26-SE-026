/**
 * ============================================================================
 * UADO Framework — Core Type Definitions
 * ============================================================================
 * 
 * Central type definitions for the Uncertainty-Aware Dispatch Optimization
 * framework. All service types, provider types, incident states, and
 * algorithm interfaces are defined here.
 * 
 * Design Decision: We use string literal union types instead of TypeScript
 * enums for better JSON serialization, Prisma compatibility, and tree-shaking.
 * These are mirrored in the Prisma schema as PostgreSQL enums.
 * 
 * @module types
 * @author Janukshan Sivakumar - IT22635266
 */

// ─────────────────────────────────────────────────────────
// Service Types — What kind of help is needed?
// ─────────────────────────────────────────────────────────

/**
 * The 9 possible roadside service types that the diagnostic triage engine
 * can identify. These form the probability distribution output.
 * 
 * Based on real-world roadside incident distributions validated through
 * consultations with Sri Lankan roadside assistance providers.
 */
export const SERVICE_TYPES = [
  'BATTERY_JUMP',
  'BATTERY_REPLACE',
  'STARTER_MOTOR',
  'FUEL_DELIVERY',
  'FLAT_TIRE',
  'LOCKOUT',
  'MECHANIC_FIX',
  'TOW_LIGHT',
  'TOW_HEAVY',
] as const;

export type ServiceType = typeof SERVICE_TYPES[number];

// ─────────────────────────────────────────────────────────
// Provider Types — Who can help?
// ─────────────────────────────────────────────────────────

/**
 * The 5 categories of service providers in the roadside assistance network.
 * Each provider type can handle a specific subset of service types,
 * defined in the capability matrix.
 */
export const PROVIDER_TYPES = [
  'MOBILE_MECHANIC',
  'FUEL_DELIVERY',
  'LOCKSMITH',
  'TOW_LIGHT',
  'TOW_HEAVY',
] as const;

export type ProviderType = typeof PROVIDER_TYPES[number];

// ─────────────────────────────────────────────────────────
// Incident Status — Lifecycle state machine
// ─────────────────────────────────────────────────────────

/**
 * Incident lifecycle states. An incident progresses linearly through these
 * states, with possible loops back to DISPATCHING on provider decline.
 * 
 * Flow: CREATED → TRIAGING → DISPATCHING → PROVIDER_ASSIGNED → EN_ROUTE
 *       → ON_SCENE → RESOLVED
 *                  → ESCALATED (if on-scene provider can't handle)
 *       CANCELLED (user cancels at any point)
 */
export const INCIDENT_STATUSES = [
  'CREATED',
  'TRIAGING',
  'DISPATCHING',
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ON_SCENE',
  'RESOLVED',
  'ESCALATED',
  'CANCELLED',
] as const;

export type IncidentStatus = typeof INCIDENT_STATUSES[number];

// ─────────────────────────────────────────────────────────
// Diagnostic Triage Types
// ─────────────────────────────────────────────────────────

/**
 * Triage tier determines the data sources used for diagnosis.
 * - QUESTIONNAIRE_ONLY: No OBD-II, no historical data (baseline)
 * - OBD_ENHANCED: Questionnaire + OBD-II vehicle telemetry
 * - BAYESIAN_LEARNED: OBD-enhanced + historical Bayesian priors
 */
export type TriageTier = 'QUESTIONNAIRE_ONLY' | 'OBD_ENHANCED' | 'BAYESIAN_LEARNED';

/**
 * A probability distribution over service types.
 * Each key is a ServiceType, and the value is a probability [0, 1].
 * All values must sum to 1.0 (within floating-point tolerance).
 */
export type ServiceTypeProbabilities = Record<ServiceType, number>;

/**
 * Dashboard warning lamp identifiers.
 * These correspond to visual icons shown to the user in Q4.
 * 
 * Design Decision: We use visual icon selection rather than text options
 * because drivers can visually match lit dashboard indicators more accurately
 * than describing them by name.
 */
export const DASHBOARD_LAMPS = [
  'BATTERY',           // Battery/charging system warning
  'CHECK_ENGINE',      // Engine/MIL warning  
  'OIL_PRESSURE',      // Oil pressure warning
  'TEMPERATURE',       // Engine temperature/overheating
  'ABS',               // Anti-lock braking system
  'BRAKE',             // Brake system warning
  'AIRBAG',            // Airbag/SRS system
  'TIRE_PRESSURE',     // TPMS warning
  'TRANSMISSION',      // Transmission temperature/fault
] as const;

export type DashboardLamp = typeof DASHBOARD_LAMPS[number];

/**
 * Engine start sound identifiers for Q3.
 * Each corresponds to a characteristic sound pattern that maps
 * to specific fault categories.
 * 
 * Design Decision: Audio/descriptive samples help users match what they
 * actually hear rather than interpreting technical descriptions.
 */
export const ENGINE_SOUNDS = [
  'RAPID_CLICKING',       // → Battery/solenoid issue
  'SINGLE_CLICK',         // → Starter motor failure
  'GRINDING_WHIRRING',    // → Starter gear/flywheel damage
  'CRANKS_NO_START',      // → Fuel/ignition system issue
  'NO_SOUND',             // → Complete electrical failure
] as const;

export type EngineSound = typeof ENGINE_SOUNDS[number];

/**
 * The complete triage questionnaire response structure.
 * Each field corresponds to one of the 8 diagnostic questions.
 */
export interface TriageResponses {
  /** Q1: Visible damage to the vehicle? */
  visibleDamage: 'CRASH' | 'MINOR' | 'NONE';

  /** Q2: Can you start the engine? */
  canStartEngine: 'YES' | 'NO' | 'PARTIAL';

  /** Q3: What sound does the engine make? (shown only if Q2 != YES) */
  engineSound?: EngineSound;

  /** Q4: Which dashboard warning lights are on? (multi-select icon picker) */
  dashboardLamps: DashboardLamp[];

  /** Q5: Is there fluid leaking under the vehicle? (conditional on visible clues) */
  fluidLeaking?: 'YES_COOLANT' | 'YES_OIL' | 'YES_FUEL' | 'YES_UNKNOWN' | 'NO';

  /** Q6: When did the problem start? */
  problemOnset: 'JUST_NOW' | 'TODAY' | 'GRADUAL';

  /** Q7: Any unusual smells? */
  unusualSmells: 'BURNING' | 'FUEL' | 'ROTTEN_EGGS' | 'NONE';

  /** Q8: Any recent warning signs before the incident? */
  recentWarnings: ('FLICKERING_LIGHTS' | 'POWER_LOSS' | 'UNUSUAL_NOISES' | 'NONE')[];
}

/**
 * Output of the Diagnostic Triage Engine.
 */
export interface TriageResult {
  /** Probability distribution over all 9 service types */
  probabilities: ServiceTypeProbabilities;

  /** The most likely service type */
  predictedServiceType: ServiceType;

  /** Confidence level [0, 1] — how concentrated the distribution is */
  confidence: number;

  /** Which tier of triage was used */
  tier: TriageTier;

  /** Entropy of the probability distribution (lower = more certain) */
  entropy: number;

  /** Whether OBD-II data was used */
  obdDataUsed: boolean;

  /** Whether Bayesian priors were applied */
  bayesianPriorsApplied: boolean;
}

// ─────────────────────────────────────────────────────────
// OBD-II Vehicle Telemetry
// ─────────────────────────────────────────────────────────

/**
 * OBD-II data retrieved from the Predictive Maintenance component.
 * Used in Tier 2 (OBD-Enhanced) to improve diagnostic accuracy.
 */
export interface OBDData {
  /** Battery voltage in volts (normal: ~12.4V running, ~14.2V charging) */
  batteryVoltage?: number;

  /** Coolant temperature in Celsius (normal: 80-100°C) */
  coolantTemp?: number;

  /** Active Diagnostic Trouble Codes (e.g., "P0562", "P0300") */
  faultCodes: string[];

  /** Engine RPM (0 if engine not running) */
  engineRPM?: number;

  /** Fuel level percentage [0-100] */
  fuelLevel?: number;

  /** Oil pressure in PSI (normal: 25-65 PSI) */
  oilPressure?: number;

  /** Predictive alerts from the Predictive Maintenance component */
  predictiveAlerts?: string[];

  /** Whether data was successfully retrieved */
  available: boolean;
}

// ─────────────────────────────────────────────────────────
// Provider & Dispatch Types
// ─────────────────────────────────────────────────────────

/** Geographic coordinates */
export interface Location {
  latitude: number;
  longitude: number;
}

/** Provider availability status */
export type ProviderStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';

/**
 * A service provider in the roadside assistance network.
 */
export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  location: Location;
  capabilities: ServiceType[];
  trustScore: number;       // [0, 1] — based on historical performance
  status: ProviderStatus;
  phone?: string;
  vehiclePlate?: string;
}

/**
 * The result of the ECM dispatch optimization.
 * Contains the ranked list of providers and cost breakdowns.
 */
export interface DispatchResult {
  /** Ranked providers from lowest to highest expected cost */
  rankedProviders: RankedProvider[];

  /** The selected (top-ranked) provider */
  selectedProvider: RankedProvider;

  /** Total computation time in milliseconds */
  computationTimeMs: number;

  /** Traffic impact score used (from Geo-Intelligence) */
  trafficImpactScore: number;

  /** Lambda value used for traffic externality weighting */
  lambda: number;
}

/**
 * A provider with computed expected cost and ranking.
 */
export interface RankedProvider {
  provider: Provider;
  expectedCost: number;
  rank: number;
  estimatedTravelTimeMin: number;
  estimatedServiceTimeMin: number;
  mismatchRisk: number;  // probability that provider can't handle actual service type
  costBreakdown: CostBreakdown;
}

/**
 * Detailed cost breakdown for a dispatch decision.
 * Used for transparency, debugging, and audit trails.
 */
export interface CostBreakdown {
  /** Expected service cost (weighted by probability of each service type) */
  expectedServiceCost: number;

  /** Expected mismatch penalty (weighted by probability of mismatches) */
  expectedMismatchCost: number;

  /** Traffic externality cost component */
  trafficExternalityCost: number;

  /** Trust score adjustment factor */
  trustAdjustment: number;

  /** Total expected cost */
  totalCost: number;
}

// ─────────────────────────────────────────────────────────
// Incident Types
// ─────────────────────────────────────────────────────────

/**
 * An incident request from a stranded driver.
 */
export interface Incident {
  id: string;
  status: IncidentStatus;
  location: Location;
  vehicleInfo: VehicleInfo;
  triageResponses?: TriageResponses;
  triageResult?: TriageResult;
  obdData?: OBDData;
  dispatchResult?: DispatchResult;
  assignedProviderId?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

/**
 * Vehicle information provided by the driver.
 */
export interface VehicleInfo {
  make?: string;        // e.g., "Toyota"
  model?: string;       // e.g., "Corolla"
  year?: number;        // e.g., 2019
  fuelType?: 'PETROL' | 'DIESEL' | 'HYBRID' | 'ELECTRIC';
  registrationNumber?: string;
  hasOBD?: boolean;     // Whether vehicle has connected OBD-II device
}

// ─────────────────────────────────────────────────────────
// Bayesian Learning Types
// ─────────────────────────────────────────────────────────

/**
 * Feedback collected after incident resolution.
 * Used for Bayesian prior updates (Tier 3).
 */
export interface ResolutionFeedback {
  incidentId: string;
  predictedDistribution: ServiceTypeProbabilities;
  predictedServiceType: ServiceType;
  predictedConfidence: number;
  actualServiceType: ServiceType;
  wasMatch: boolean;
  resolutionTimeMinutes: number;
  reDispatches: number;
  userRating?: number;    // 1-5 stars
  providerNotes?: string;
  timestamp: Date;
}

/**
 * Bayesian prior for a specific symptom → diagnosis mapping.
 */
export interface BayesianPrior {
  /** Hash key representing the symptom combination */
  symptomKey: string;

  /** Current probability distribution */
  probabilities: ServiceTypeProbabilities;

  /** Number of observations that contributed to this prior */
  observationCount: number;

  /** Current learning rate (decays with observations) */
  currentLearningRate: number;

  /** Last updated timestamp */
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────
// API Request/Response Types
// ─────────────────────────────────────────────────────────

/** Create incident request body */
export interface CreateIncidentRequest {
  location: Location;
  vehicleInfo?: VehicleInfo;
  description?: string;
}

/** Submit triage response request body */
export interface SubmitTriageRequest {
  incidentId: string;
  responses: TriageResponses;
}

/** Dispatch optimization request body */
export interface DispatchRequest {
  incidentId: string;
  trafficImpactScore?: number;   // Override from Geo-Intelligence, 1-10
  maxProviders?: number;         // Max providers to evaluate (default: all)
}

/** Provider acceptance/decline */
export interface ProviderResponse {
  incidentId: string;
  providerId: string;
  accepted: boolean;
  declineReason?: string;
}

/** Resolution report from provider */
export interface ResolutionReport {
  incidentId: string;
  providerId: string;
  actualServiceType: ServiceType;
  resolutionTimeMinutes: number;
  notes?: string;
  escalationNeeded?: boolean;
}

// ─────────────────────────────────────────────────────────
// API Response wrapper
// ─────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}
