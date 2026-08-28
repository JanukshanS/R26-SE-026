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

/** Can this provider type handle this service type? Ceiling check only — see
 *  providerHasCapability() for the actual per-provider dispatch-time check. */
export function canProviderHandle(p: ProviderType, s: ServiceType): boolean {
  return CAPABILITY_MATRIX[p]?.has(s) ?? false;
}

/** All service types this provider type can handle. Registration default and
 *  the "your specialization" set — not the ceiling for what can be ADDED;
 *  see getAllServiceTypes() for that. */
export function getProviderCapabilities(p: ProviderType): ServiceType[] {
  return Array.from(CAPABILITY_MATRIX[p] ?? []);
}

/**
 * Every service type any provider type can handle — the union across the
 * whole matrix. This is the ceiling for a provider's own editable
 * `capabilities` list: a provider's primary `type` sets their default/
 * specialization set, but they may additionally offer any service type here
 * (e.g. a Locksmith who also carries jump-start cables and fuel cans),
 * constrained to real, matrix-backed service types rather than free-form.
 */
export function getAllServiceTypes(): ServiceType[] {
  const all = new Set<ServiceType>();
  for (const set of Object.values(CAPABILITY_MATRIX)) {
    for (const s of set) all.add(s);
  }
  return Array.from(all);
}

/**
 * Can this SPECIFIC provider (by their own declared capabilities, not their
 * type) handle this service type? This is what dispatch-optimizer.ts uses
 * for match/mismatch — a provider's `capabilities` array is the real,
 * editable source of truth, not a re-derivation from `type`.
 */
export function providerHasCapability(
  capabilities: Iterable<ServiceType>,
  s: ServiceType,
): boolean {
  return capabilities instanceof Set ? capabilities.has(s) : new Set(capabilities).has(s);
}

/**
 * Mismatch risk for a provider given a probability distribution:
 *   P(provider can't handle the actual service needed)
 * = Σ P(type_k) for type_k NOT in the provider's own capabilities.
 */
export function calculateMismatchRisk(
  capabilities: Iterable<ServiceType>,
  probabilities: Record<ServiceType, number>,
): number {
  const caps = capabilities instanceof Set ? capabilities : new Set(capabilities);
  let risk = 0;
  for (const [serviceType, probability] of Object.entries(probabilities)) {
    if (!caps.has(serviceType as ServiceType)) risk += probability;
  }
  return risk;
}
