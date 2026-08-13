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
}

interface VehicleInsuranceRow {
  vehicle_id: string;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
}

function mapVehicleInsurance(r: VehicleInsuranceRow): VehicleInsurance {
  return {
    vehicleId: r.vehicle_id,
    insuranceProvider: r.insurance_provider ?? undefined,
    insurancePolicyNumber: r.insurance_policy_number ?? undefined,
  };
}

export async function getVehicleInsurance(vehicleId: string): Promise<VehicleInsurance | null> {
  const { data, error } = await supabase
    .from("vehicle_insurance")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (error) throw new VehicleApiError(error.message);
  return data ? mapVehicleInsurance(data as VehicleInsuranceRow) : null;
}

export interface VehicleInsuranceInput {
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
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
  const { data: result, error } = await supabase
    .from("vehicle_insurance")
    .upsert(row, { onConflict: "vehicle_id" })
    .select()
    .single();
  if (error) throw new VehicleApiError(error.message);
  return mapVehicleInsurance(result as VehicleInsuranceRow);
}
