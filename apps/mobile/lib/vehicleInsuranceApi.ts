import { supabase } from "@lib/supabase";
import { VehicleApiError } from "@lib/vehicleApi";

/**
 * Insurance is a separate table (`vehicle_insurance`, one row per vehicle) rather than
 * columns on `vehicles` — the `vehicles` table's own shape is owned elsewhere and isn't
 * meant to be extended.
 */
export interface VehicleInsurance {
  vehicleId: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  /** "YY/MM" format, e.g. "26/09" — validated in app/(onboarding)/add-insurer.tsx. */
  insuranceExpireMonth?: string;
}

interface VehicleInsuranceRow {
  vehicle_id: string;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_expire_month: string | null;
}

function mapVehicleInsurance(r: VehicleInsuranceRow): VehicleInsurance {
  return {
    vehicleId: r.vehicle_id,
    insuranceProvider: r.insurance_provider ?? undefined,
    insurancePolicyNumber: r.insurance_policy_number ?? undefined,
    insuranceExpireMonth: r.insurance_expire_month ?? undefined,
  };
}

// Keyed by vehicle_id — RLS already scopes this table per-owner, so there's no
// cross-account risk in principle (a different account could never fetch someone
// else's vehicle_id successfully), but it's still cleared on logout for consistency
// with getCachedMyUser(). getCachedVehicleInsurance() lets a screen seed its initial
// render instead of a blank/placeholder state; getVehicleInsurance() still always
// hits the network for the authoritative value and keeps the cache warm.
const insuranceCache = new Map<string, VehicleInsurance | null>();

export function getCachedVehicleInsurance(vehicleId: string): VehicleInsurance | null | undefined {
  return insuranceCache.get(vehicleId);
}

export function clearVehicleInsuranceCache(): void {
  insuranceCache.clear();
}

export async function getVehicleInsurance(vehicleId: string): Promise<VehicleInsurance | null> {
  const { data, error } = await supabase
    .from("vehicle_insurance")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (error) throw new VehicleApiError(error.message);
  const result = data ? mapVehicleInsurance(data as VehicleInsuranceRow) : null;
  insuranceCache.set(vehicleId, result);
  return result;
}

export interface VehicleInsuranceInput {
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpireMonth?: string;
}

/** One row per vehicle — insert on first save, update on every save after. */
export async function upsertVehicleInsurance(
  vehicleId: string,
  data: VehicleInsuranceInput
): Promise<VehicleInsurance> {
  const row: Record<string, unknown> = { vehicle_id: vehicleId };
  if (data.insuranceProvider !== undefined) row.insurance_provider = data.insuranceProvider || null;
  if (data.insurancePolicyNumber !== undefined)
    row.insurance_policy_number = data.insurancePolicyNumber || null;
  if (data.insuranceExpireMonth !== undefined)
    row.insurance_expire_month = data.insuranceExpireMonth || null;
  const { data: result, error } = await supabase
    .from("vehicle_insurance")
    .upsert(row, { onConflict: "vehicle_id" })
    .select()
    .single();
  if (error) throw new VehicleApiError(error.message, error.code);
  const mapped = mapVehicleInsurance(result as VehicleInsuranceRow);
  insuranceCache.set(vehicleId, mapped);
  return mapped;
}
