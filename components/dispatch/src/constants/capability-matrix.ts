/**
 * ============================================================================
 * Provider Capability Matrix
 * ============================================================================
 * 
 * Defines which service types each provider type can handle.
 * This is the core lookup table used by the ECM algorithm to determine
 * match vs. mismatch costs.
 * 
 * Key insight: Tow trucks have broader capabilities (battery, flat tire, towing)
 * while specialists (locksmith, fuel delivery) are limited. This asymmetry is
 * critical when diagnosis is uncertain — a tow truck is a "safer" dispatch
 * choice but more expensive.
 * 
 * Source: Validated against Sri Lankan roadside provider capabilities through
 * informal consultations with local providers and insurance representatives.
 * 
 * @module constants/capability-matrix
 * @author Janukshan Sivakumar - IT22635266
 */

import { ProviderType, ServiceType } from '../types';

/**
 * Provider Type → Set of ServiceTypes it can handle.
 * 
 * Matrix (from research proposal Table 13):
 * 
 * Provider Type     | Battery | Flat Tire | Fuel | Lockout | Mechanic Fix | Tow Light | Tow Heavy
 * ─────────────────-+---------+-----------+------+---------+--------------+-----------+----------
 * Mobile Mechanic   |    ✓    |     ✓     |  ✗   |    ✗    |      ✓       |     ✗     |    ✗
 * Fuel Delivery     |    ✗    |     ✗     |  ✓   |    ✗    |      ✗       |     ✗     |    ✗
 * Locksmith         |    ✗    |     ✗     |  ✗   |    ✓    |      ✗       |     ✗     |    ✗
 * Light Tow Truck   |    ✓    |     ✓     |  ✗   |    ✗    |      ✗       |     ✓     |    ✗
 * Heavy Tow Truck   |    ✓    |     ✓     |  ✗   |    ✗    |      ✗       |     ✓     |    ✓
 */
export const CAPABILITY_MATRIX: Record<ProviderType, Set<ServiceType>> = {
  MOBILE_MECHANIC: new Set([
    'BATTERY_JUMP',
    'BATTERY_REPLACE',
    'FLAT_TIRE',
    'MECHANIC_FIX',
  ]),

  FUEL_DELIVERY: new Set([
    'FUEL_DELIVERY',
  ]),

  LOCKSMITH: new Set([
    'LOCKOUT',
  ]),

  TOW_LIGHT: new Set([
    'BATTERY_JUMP',
    'FLAT_TIRE',
    'TOW_LIGHT',
  ]),

  TOW_HEAVY: new Set([
    'BATTERY_JUMP',
    'FLAT_TIRE',
    'TOW_LIGHT',
    'TOW_HEAVY',
  ]),
};

/**
 * Check if a specific provider type can handle a given service type.
 */
export function canProviderHandle(providerType: ProviderType, serviceType: ServiceType): boolean {
  return CAPABILITY_MATRIX[providerType]?.has(serviceType) ?? false;
}

/**
 * Get all capabilities for a provider type.
 */
export function getProviderCapabilities(providerType: ProviderType): ServiceType[] {
  return Array.from(CAPABILITY_MATRIX[providerType] || []);
}

/**
 * Calculate mismatch risk: probability that the provider CANNOT handle the actual service needed.
 * mismatchRisk = Σ P(type_k) for all type_k NOT in provider's capabilities
 */
export function calculateMismatchRisk(
  providerType: ProviderType,
  probabilities: Record<ServiceType, number>
): number {
  let risk = 0;
  for (const [serviceType, probability] of Object.entries(probabilities)) {
    if (!canProviderHandle(providerType, serviceType as ServiceType)) {
      risk += probability;
    }
  }
  return risk;
}
