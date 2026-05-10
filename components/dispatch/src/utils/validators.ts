/**
 * ============================================================================
 * Zod Validation Schemas — runtime input validation
 * ============================================================================
 *
 * Validates all API inputs at runtime to prevent invalid data from reaching
 * the triage engine or ECM optimiser. Aligned with the new adaptive
 * questionnaire (TriageResponses in src/types/index.ts).
 *
 * @module utils/validators
 * @author Janukshan Sivakumar - IT22635266
 */

import { z } from 'zod';
import {
  SERVICE_TYPES, PROVIDER_TYPES,
  DASHBOARD_LAMPS, RECENT_WARNINGS,
  Q1_ML_INTENTS, Q1_FAST_INTENTS, NOT_ASKED,
} from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────

const enumOf = <T extends string>(values: readonly T[]) =>
  z.enum(values as unknown as [T, ...T[]]);

/** Adaptive single-select: a value from the enum OR the literal "NOT_ASKED". */
const adaptiveOf = <T extends string>(values: readonly T[]) =>
  z.union([
    z.enum(values as unknown as [T, ...T[]]),
    z.literal(NOT_ASKED),
  ]);

// ─── Common ──────────────────────────────────────────────────────────────

export const locationSchema = z.object({
  latitude:  z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const vehicleInfoSchema = z.object({
  make:               z.string().optional(),
  model:              z.string().optional(),
  year:               z.number().int().min(1900).max(2030).optional(),
  fuelType:           z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']).optional(),
  registrationNumber: z.string().optional(),
  hasOBD:             z.boolean().optional(),
}).optional();

export const createIncidentSchema = z.object({
  location:    locationSchema,
  vehicleInfo: vehicleInfoSchema,
  description: z.string().max(500).optional(),
});

// ─── Adaptive triage responses ───────────────────────────────────────────

const Q1_ALL_INTENTS = [...Q1_ML_INTENTS, ...Q1_FAST_INTENTS] as const;

export const triageResponsesSchema = z.object({
  // Q1 — required
  Q1_intent:         enumOf(Q1_ALL_INTENTS),

  // Adaptive single-selects (each accepts NOT_ASKED for unvisited paths)
  Q2_engine_start:   adaptiveOf(['STARTS_NORMAL', 'STARTS_BUT_ISSUE',
                                 'CRANKS_NO_START', 'NO_CRANK'] as const),
  Q2b_running_issue: adaptiveOf(['OVERHEATING', 'NOISE', 'NO_POWER',
                                 'SMOKE', 'STALLING'] as const),
  Q3_sound:          adaptiveOf(['RAPID_CLICKING', 'SINGLE_CLICK',
                                 'NORMAL_CRANKING', 'GRINDING',
                                 'NOTHING', 'WHIRRING'] as const),
  Q3b_electrical:    adaptiveOf(['ALL_DEAD_NO_LIGHTS', 'DIM_LIGHTS',
                                 'SOME_LIGHTS_ON'] as const),
  Q4_noise_detail:   adaptiveOf(['SQUEAL', 'KNOCK', 'GRIND',
                                 'WHINE', 'CLUNK'] as const),
  Q7_overheat_detail:adaptiveOf(['TRAFFIC_ONLY', 'ALWAYS',
                                 'HILL_CLIMB', 'WITH_AC'] as const),
  Q8_smoke_color:    adaptiveOf(['WHITE', 'BLUE_GREY', 'BLACK',
                                 'ELECTRICAL_BURNING'] as const),
  Q_brake_detail:    adaptiveOf(['SQUEALING', 'GRINDING',
                                 'PULL_ONE_SIDE', 'SOFT_PEDAL'] as const),
  Q_gear_detail:     adaptiveOf(['SLIPPING', 'WONT_ENGAGE',
                                 'GRINDING', 'CLUTCH_SOFT'] as const),
  Q6_smells:         enumOf(['BURNING_ELECTRICAL', 'BURNING_OIL', 'FUEL_SMELL',
                             'ROTTEN_EGGS', 'SWEET', 'NO_SMELL'] as const),

  // Multi-select tail
  Q5_lights:         z.array(enumOf(DASHBOARD_LAMPS)),
  Q9_recent:         z.array(enumOf(RECENT_WARNINGS)),

  // Sri Lankan context
  location_type:      enumOf(['COASTAL', 'HILL', 'URBAN', 'RURAL'] as const),
  recent_rain:        enumOf(['NONE', 'YESTERDAY', 'WITHIN_3_DAYS', 'MONSOON'] as const),
  parked_overnight:   enumOf(['INDOOR', 'OUTDOOR'] as const),
  vehicle_age_bucket: enumOf(['UNDER_3', '3_7', '8_15', 'OVER_15'] as const),
  last_fueled:        enumOf(['TODAY_NEW_STATION', 'TODAY_USUAL',
                              'WITHIN_WEEK', 'OVER_WEEK'] as const),
});

// ─── OBD telemetry (optional in /triage/submit) ──────────────────────────

export const obdDataSchema = z.object({
  battery_voltage_v:      z.number().optional(),
  battery_temp_c:         z.number().optional(),
  battery_charge_percent: z.number().optional(),
  battery_health_percent: z.number().optional(),
  alternator_output_v:    z.number().optional(),
  engine_temp_c:          z.number().optional(),
  coolant_temp_c:         z.number().optional(),
  engine_rpm:             z.number().optional(),
  oil_pressure_psi:       z.number().optional(),
  fuel_level_percent:     z.number().optional(),
  engine_load_percent:    z.number().optional(),
  ambient_temp_c:         z.number().optional(),
  brake_fluid_level_psi:  z.number().optional(),
  brake_pad_wear_mm:      z.number().optional(),
  brake_temp_c:           z.number().optional(),
  faultCodes:             z.array(z.string()).optional(),
  predictiveAlerts:       z.array(z.string()).optional(),
  available:              z.boolean(),
});

export const submitTriageSchema = z.object({
  incidentId: z.string().uuid(),
  responses:  triageResponsesSchema,
  obdData:    obdDataSchema.optional(),
});

// ─── Dispatch & provider ─────────────────────────────────────────────────

export const dispatchRequestSchema = z.object({
  incidentId:         z.string().uuid(),
  trafficImpactScore: z.number().min(1).max(10).optional(),
  maxProviders:       z.number().int().min(1).max(100).optional(),
});

export const providerResponseSchema = z.object({
  incidentId:    z.string().uuid(),
  providerId:    z.string().uuid(),
  accepted:      z.boolean(),
  declineReason: z.string().max(200).optional(),
});

export const resolutionReportSchema = z.object({
  incidentId:            z.string().uuid(),
  providerId:            z.string().uuid(),
  actualServiceType:     enumOf(SERVICE_TYPES),
  resolutionTimeMinutes: z.number().min(0).max(480),
  notes:                 z.string().max(1000).optional(),
  escalationNeeded:      z.boolean().optional(),
});

export const createProviderSchema = z.object({
  name:         z.string().min(2).max(100),
  type:         enumOf(PROVIDER_TYPES),
  location:     locationSchema,
  phone:        z.string().optional(),
  vehiclePlate: z.string().optional(),
});
