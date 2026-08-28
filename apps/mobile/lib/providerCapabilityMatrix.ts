/**
 * Provider Type → Service Type default/specialization set.
 *
 * Mirrors components/dispatch/src/constants/capability-matrix.ts exactly —
 * the backend is the source of truth and re-validates this same shape on
 * PATCH /providers/:id/profile. `type` sets a provider's default
 * capabilities at registration and drives the Services screen's "your
 * specialization" grouping — it is NOT a ceiling on what a provider can
 * ADD (a Locksmith may also carry jump-start cables and fuel cans). The
 * real ceiling is ALL_SERVICE_TYPES below: any service type any provider
 * type can do, not a free-form string.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import type { ProviderType, ServiceType } from "@lib/dispatchApi";

export const PROVIDER_CAPABILITY_MATRIX: Record<ProviderType, ServiceType[]> = {
  MOBILE_MECHANIC: [
    "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE",
    "ALTERNATOR_ISSUE",
    "STARTER_MOTOR",
    "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK",
    "BELT_BROKEN",
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN",
    "BRAKE_PAD_WORN",
    "FLAT_TIRE_CHANGE",
    "LIGHT_BULB", "BLOWN_FUSE",
  ],
  FUEL_DELIVERY: [
    "FUEL_EMPTY",
    "FUEL_WRONG",
  ],
  LOCKSMITH: [
    "LOCKOUT", "KEY_LOST",
  ],
  TOW_LIGHT: [
    "BATTERY_JUMP",
    "FLAT_TIRE_CHANGE",
    "STARTER_MOTOR",
    "ALTERNATOR_ISSUE",
    "BELT_BROKEN",
    "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK",
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN",
    "BRAKE_PAD_WORN", "BRAKE_FAILURE",
    "CLUTCH_WORN", "TRANSMISSION_ISSUE",
    "ENGINE_OVERHEAT_SEVERE",
  ],
  TOW_HEAVY: [
    "BATTERY_JUMP",
    "FLAT_TIRE_CHANGE",
    "STARTER_MOTOR",
    "ALTERNATOR_ISSUE",
    "BELT_BROKEN",
    "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK",
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN",
    "BRAKE_PAD_WORN", "BRAKE_FAILURE",
    "CLUTCH_WORN", "TRANSMISSION_ISSUE",
    "ENGINE_OVERHEAT_SEVERE",
    "SEVERE_MECHANICAL_TOW",
    "MAJOR_ACCIDENT",
    "URGENT_TOW",
    "FLOOD_RECOVERY",
  ],
};

/** Every service type any provider type can do — the real ceiling for a
 *  provider's own editable `capabilities`, not just their `type`'s set. */
export const ALL_SERVICE_TYPES: ServiceType[] = Array.from(
  new Set(Object.values(PROVIDER_CAPABILITY_MATRIX).flat())
);
