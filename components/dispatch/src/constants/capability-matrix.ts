/**
 * ============================================================================
 * Provider Capability Matrix (29 service types × 5 provider types)
 * ============================================================================
 *
 * Lookup table for which provider types can handle which service types.
 * Used by the ECM optimizer to decide MATCH vs MISMATCH cost for every
 * (provider, service_type) pair.
 *
 * The 29 service types come from src/types/index.ts:
 *   - 19 ML-diagnosable types (output of the decision tree)
 *   - 10 fast-path types (driver self-selects)
 *
 * Capability rationale:
 *   - MOBILE_MECHANIC: anything fixable on-scene (battery, fuel filter,
 *     belt, sensor, fuse, light bulb). Cannot tow.
 *   - FUEL_DELIVERY:   only fuel-related fast-paths.
 *   - LOCKSMITH:       only lock/key fast-paths.
 *   - TOW_LIGHT:       can tow most cars; can also cover quick on-scene
 *     fixes that don't need a full mechanic visit (jump, tire change).
 *   - TOW_HEAVY:       superset of TOW_LIGHT plus heavy/severe cases.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { ProviderType, ServiceType } from '../types';

export const CAPABILITY_MATRIX: Record<ProviderType, Set<ServiceType>> = {
  // ── MOBILE_MECHANIC ─────────────────────────────────────────────────
  // Anything fixable on the roadside without towing. Battery work,
  // belts, fluids, fuel filter, sensor reset, bulbs/fuses.
  MOBILE_MECHANIC: new Set<ServiceType>([
    'BATTERY_JUMP', 'BATTERY_TERMINAL_CLEAN', 'BATTERY_REPLACE',
    'ALTERNATOR_ISSUE',
    'STARTER_MOTOR',
    'COOLANT_LOW', 'RADIATOR_FAN_ISSUE', 'RADIATOR_HOSE_LEAK',
    'BELT_BROKEN',
    'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM',
    'ELECTRICAL_FAULT_RAIN',
    'BRAKE_PAD_WORN',
    // Fast-paths
    'FLAT_TIRE_CHANGE',
    'LIGHT_BULB', 'BLOWN_FUSE',
  ]),

  // ── FUEL_DELIVERY ────────────────────────────────────────────────────
  FUEL_DELIVERY: new Set<ServiceType>([
    'FUEL_EMPTY',
    'FUEL_WRONG',  // delivers fresh correct fuel; tow needed if tank contaminated
  ]),

  // ── LOCKSMITH ────────────────────────────────────────────────────────
  LOCKSMITH: new Set<ServiceType>([
    'LOCKOUT', 'KEY_LOST',
  ]),

  // ── TOW_LIGHT ────────────────────────────────────────────────────────
  // Light tow truck. Can do battery jumps and tire changes on-scene.
  // Tows passenger cars to a workshop for the harder work.
  TOW_LIGHT: new Set<ServiceType>([
    'BATTERY_JUMP',
    'FLAT_TIRE_CHANGE',
    'STARTER_MOTOR',                  // tow to garage
    'ALTERNATOR_ISSUE',               // tow to garage
    'BELT_BROKEN',                    // tow to garage
    'RADIATOR_FAN_ISSUE',             // tow to garage
    'RADIATOR_HOSE_LEAK',             // tow to garage
    'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM',
    'ELECTRICAL_FAULT_RAIN',
    'BRAKE_PAD_WORN', 'BRAKE_FAILURE',
    'CLUTCH_WORN', 'TRANSMISSION_ISSUE',
    'ENGINE_OVERHEAT_SEVERE',
  ]),

  // ── TOW_HEAVY ────────────────────────────────────────────────────────
  // Heavy recovery: trucks/SUVs, accidents, ditches, floods.
  TOW_HEAVY: new Set<ServiceType>([
    // Everything TOW_LIGHT can do
    'BATTERY_JUMP',
    'FLAT_TIRE_CHANGE',
    'STARTER_MOTOR',
    'ALTERNATOR_ISSUE',
    'BELT_BROKEN',
    'RADIATOR_FAN_ISSUE', 'RADIATOR_HOSE_LEAK',
    'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM',
    'ELECTRICAL_FAULT_RAIN',
    'BRAKE_PAD_WORN', 'BRAKE_FAILURE',
    'CLUTCH_WORN', 'TRANSMISSION_ISSUE',
    'ENGINE_OVERHEAT_SEVERE',
    // Heavy-only
    'SEVERE_MECHANICAL_TOW',
    'MAJOR_ACCIDENT',
    'URGENT_TOW',
    'FLOOD_RECOVERY',
  ]),
};

/** Can this provider type handle this service type? */
export function canProviderHandle(p: ProviderType, s: ServiceType): boolean {
  return CAPABILITY_MATRIX[p]?.has(s) ?? false;
}

/** All service types this provider type can handle. */
export function getProviderCapabilities(p: ProviderType): ServiceType[] {
  return Array.from(CAPABILITY_MATRIX[p] ?? []);
}

/**
 * Mismatch risk for a provider given a probability distribution:
 *   P(provider can't handle the actual service needed)
 * = Σ P(type_k) for type_k NOT in provider's capabilities.
 */
export function calculateMismatchRisk(
  p: ProviderType,
  probabilities: Record<ServiceType, number>,
): number {
  let risk = 0;
  for (const [serviceType, probability] of Object.entries(probabilities)) {
    if (!canProviderHandle(p, serviceType as ServiceType)) risk += probability;
  }
  return risk;
}
