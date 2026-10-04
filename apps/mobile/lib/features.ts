/**
 * Build-time feature switches.
 *
 * The v1.0 production launch ships accounts (driver + service provider),
 * roadside SOS/dispatch and the questionnaire-based issue diagnosis. Insurance
 * claims, predictive maintenance, OBD-II telemetry and the parts marketplace
 * are held back for later updates, so they default OFF here.
 *
 * Each one can be switched back on per build with `EXPO_PUBLIC_FEATURE_<NAME>=1`
 * (e.g. for an internal/staging build). Like every EXPO_PUBLIC_* value these are
 * inlined into the bundle at build time — app.config.js reads the same variables
 * to decide which native permissions and plugins the binary carries, so a flag
 * flipped after the build has no effect.
 */

function flag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export const FEATURES = {
  insurance: flag(process.env.EXPO_PUBLIC_FEATURE_INSURANCE),
  predictiveMaintenance: flag(process.env.EXPO_PUBLIC_FEATURE_PREDICTIVE_MAINTENANCE),
  obd: flag(process.env.EXPO_PUBLIC_FEATURE_OBD),
  marketplace: flag(process.env.EXPO_PUBLIC_FEATURE_MARKETPLACE),
} as const;

export type FeatureKey = keyof typeof FEATURES;
