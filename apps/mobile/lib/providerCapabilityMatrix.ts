/**
 * Provider Type → Service Type capability ceiling.
 *
 * Mirrors components/dispatch/src/constants/capability-matrix.ts exactly —
 * the backend is the source of truth and enforces this same rule on
 * PATCH /providers/:id/profile, this copy only drives which toggles the
 * Services screen shows. A provider's own `capabilities` (editable) is a
 * SUBSET of this; this is the fixed ceiling their `type` allows.
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
