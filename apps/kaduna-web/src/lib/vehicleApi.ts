// Vehicles for the driver portal. Ported from apps/mobile/lib/vehicleApi.ts —
// same `vehicles` table, same columns, same RLS scoping (every row is already
// filtered to auth.uid(), so no explicit user_id filter is needed). Read-only:
// the web portal never creates or edits a vehicle, so mobile's write helpers,
// default-vehicle bookkeeping and session-guard caches are not ported.
import { supabase } from "./supabase";

export interface Vehicle {
  id: string;
  nickname?: string;
  make: string;
  model: string;
  year?: number;
  plateNumber: string;
  color?: string;
  currentMileage: number;
  fuelType: string;
  isDefault: boolean;
  createdAt: string;
}

interface VehicleRow {
  id: string;
  nickname: string | null;
  make: string;
  model: string;
  year: number | null;
  plate_number: string;
  color: string | null;
  current_mileage: number | null;
  fuel_type: string | null;
  is_default: boolean;
  created_at: string;
}

function mapVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    nickname: r.nickname ?? undefined,
    make: r.make,
    model: r.model,
    year: r.year ?? undefined,
    plateNumber: r.plate_number,
    color: r.color ?? undefined,
    currentMileage: r.current_mileage ?? 0,
    fuelType: r.fuel_type ?? "petrol",
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select(
      "id,nickname,make,model,year,plate_number,color,current_mileage,fuel_type,is_default,created_at"
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as VehicleRow[]).map(mapVehicle);
}

/** The vehicle a driver's health summary should describe: their default, else the oldest. */
export function defaultVehicle(vehicles: Vehicle[]): Vehicle | null {
  return vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
}

export function vehicleTitle(v: Vehicle): string {
  return v.nickname || [v.year, v.make, v.model].filter(Boolean).join(" ") || v.plateNumber;
}
