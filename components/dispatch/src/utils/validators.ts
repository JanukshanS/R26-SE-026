/**
 * ============================================================================
 * Zod Validation Schemas — Runtime Input Validation
 * ============================================================================
 * 
 * Validates all API inputs at runtime to prevent invalid data from
 * reaching the triage engine or ECM algorithm. This is critical because
 * invalid triage responses would produce meaningless probability distributions.
 * 
 * @module utils/validators
 * @author Janukshan Sivakumar - IT22635266
 */

import { z } from 'zod';
import { SERVICE_TYPES, PROVIDER_TYPES, DASHBOARD_LAMPS, ENGINE_SOUNDS } from '../types';

// ── Location ──
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// ── Vehicle Info ──
export const vehicleInfoSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().min(1900).max(2030).optional(),
  fuelType: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']).optional(),
  registrationNumber: z.string().optional(),
  hasOBD: z.boolean().optional(),
}).optional();

// ── Create Incident ──
export const createIncidentSchema = z.object({
  location: locationSchema,
  vehicleInfo: vehicleInfoSchema,
  description: z.string().max(500).optional(),
});

// ── Triage Responses ──
export const triageResponsesSchema = z.object({
  visibleDamage: z.enum(['CRASH', 'MINOR', 'NONE']),
  canStartEngine: z.enum(['YES', 'NO', 'PARTIAL']),
  engineSound: z.enum(ENGINE_SOUNDS as unknown as [string, ...string[]]).optional(),
  dashboardLamps: z.array(z.enum(DASHBOARD_LAMPS as unknown as [string, ...string[]])),
  fluidLeaking: z.enum(['YES_COOLANT', 'YES_OIL', 'YES_FUEL', 'YES_UNKNOWN', 'NO']).optional(),
  problemOnset: z.enum(['JUST_NOW', 'TODAY', 'GRADUAL']),
  unusualSmells: z.enum(['BURNING', 'FUEL', 'ROTTEN_EGGS', 'NONE']),
  recentWarnings: z.array(z.enum(['FLICKERING_LIGHTS', 'POWER_LOSS', 'UNUSUAL_NOISES', 'NONE'])),
});

export const submitTriageSchema = z.object({
  incidentId: z.string().uuid(),
  responses: triageResponsesSchema,
});

// ── Dispatch Request ──
export const dispatchRequestSchema = z.object({
  incidentId: z.string().uuid(),
  trafficImpactScore: z.number().min(1).max(10).optional(),
  maxProviders: z.number().min(1).max(100).optional(),
});

// ── Provider Response ──
export const providerResponseSchema = z.object({
  incidentId: z.string().uuid(),
  providerId: z.string().uuid(),
  accepted: z.boolean(),
  declineReason: z.string().max(200).optional(),
});

// ── Resolution Report ──
export const resolutionReportSchema = z.object({
  incidentId: z.string().uuid(),
  providerId: z.string().uuid(),
  actualServiceType: z.enum(SERVICE_TYPES as unknown as [string, ...string[]]),
  resolutionTimeMinutes: z.number().min(0).max(480),
  notes: z.string().max(1000).optional(),
  escalationNeeded: z.boolean().optional(),
});

// ── Provider Registration ──
export const createProviderSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
  location: locationSchema,
  phone: z.string().optional(),
  vehiclePlate: z.string().optional(),
});
