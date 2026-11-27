// Vehicles, insurance and the driver's profile for the web portal. Same tables
// and columns as apps/mobile/lib/vehicleApi.ts and vehicleInsuranceApi.ts, same
// RLS scoping: every vehicles / vehicle_insurance / profiles row is already
// filtered to auth.uid(), so reads need no explicit user filter. Mobile's
// login-time caches and session guards are not ported: each portal page loads
// fresh on mount.
import { normalizePlate } from "./plate";
import { supabase } from "./supabase";

export type FuelType = "petrol" | "diesel" | "hybrid" | "electric";
export const FUEL_TYPES: FuelType[] = ["petrol", "diesel", "hybrid", "electric"];

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

export interface VehicleInput {
  nickname?: string | null;
  make: string;
  model: string;
  year?: number | null;
  plateNumber: string;
  color?: string | null;
  currentMileage: number;
  fuelType: FuelType;
  isDefault: boolean;
}

/** A Postgres error code rides along so callers can tell "plate already registered" (23505) from the rest. */
export class VehicleApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "VehicleApiError";
    this.code = code;
  }
}

interface VehicleRow {
  id: string;
  user_id?: string;
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

const VEHICLE_COLUMNS = "id,user_id,nickname,make,model,year,plate_number,color,current_mileage,fuel_type,is_default,created_at";

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

function toRow(v: VehicleInput): Record<string, unknown> {
  return {
    nickname: v.nickname?.trim() || null,
    make: v.make.trim(),
    model: v.model.trim(),
    year: v.year ?? null,
    plate_number: normalizePlate(v.plateNumber),
    color: v.color?.trim() || null,
    current_mileage: Math.max(0, Math.round(v.currentMileage)),
    fuel_type: v.fuelType,
    is_default: v.isDefault,
  };
}

function fail(error: { message: string; code?: string }): never {
  throw new VehicleApiError(error.message, error.code);
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new VehicleApiError("Not signed in");
  return id;
}

// ─── Vehicles ────────────────────────────────────────────────────────────

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase.from("vehicles").select(VEHICLE_COLUMNS).order("created_at", { ascending: true });
  if (error) fail(error);
  return (data as VehicleRow[]).map(mapVehicle);
}

/** Keep one default per driver: clear the flag on every other row. */
async function clearOtherDefaults(userId: string, keepId: string) {
  const { error } = await supabase.from("vehicles").update({ is_default: false }).eq("user_id", userId).neq("id", keepId);
  if (error) fail(error);
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...toRow(input), user_id: userId })
    .select(VEHICLE_COLUMNS)
    .single();
  if (error) fail(error);
  const row = data as VehicleRow;
  if (row.is_default) await clearOtherDefaults(userId, row.id);
  return mapVehicle(row);
}

/**
 * The plate is left alone on purpose: trips, service history and breakdown
 * reports are all filed under it, so renaming it would orphan them.
 */
export async function updateVehicle(id: string, input: Omit<VehicleInput, "plateNumber">): Promise<Vehicle> {
  const { plate_number: _plate, ...patch } = toRow({ ...input, plateNumber: "" });
  const { data, error } = await supabase.from("vehicles").update(patch).eq("id", id).select(VEHICLE_COLUMNS).single();
  if (error) fail(error);
  const row = data as VehicleRow;
  if (row.is_default) await clearOtherDefaults(row.user_id ?? (await currentUserId()), row.id);
  return mapVehicle(row);
}

export async function setDefaultVehicle(id: string): Promise<void> {
  const userId = await currentUserId();
  await clearOtherDefaults(userId, id);
  const { error } = await supabase.from("vehicles").update({ is_default: true }).eq("id", id);
  if (error) fail(error);
}

export async function deleteVehicle(id: string): Promise<void> {
  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) fail(error);
}

/** The vehicle a summary should describe: the default, else the oldest. */
export function defaultVehicle(vehicles: Vehicle[]): Vehicle | null {
  return vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
}

export function vehicleTitle(v: Vehicle): string {
  return v.nickname || [v.year, v.make, v.model].filter(Boolean).join(" ") || v.plateNumber;
}

/** "2016 Toyota Aqua", for a second line under a nickname. */
export function vehicleModelLine(v: Vehicle): string {
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

// ─── Insurance (one vehicle_insurance row per vehicle) ───────────────────

export interface VehicleInsurance {
  vehicleId: string;
  provider: string | null;
  policyNumber: string | null;
  /** "YY/MM", e.g. "26/09": the month the policy runs out. */
  expireMonth: string | null;
}

interface InsuranceRow {
  vehicle_id: string;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_expire_month: string | null;
}

/** Every policy the driver has on file, keyed by vehicle id. */
export async function listInsurance(): Promise<Record<string, VehicleInsurance>> {
  const { data, error } = await supabase.from("vehicle_insurance").select("vehicle_id,insurance_provider,insurance_policy_number,insurance_expire_month");
  if (error) fail(error);
  return Object.fromEntries(
    (data as InsuranceRow[]).map((r) => [
      r.vehicle_id,
      { vehicleId: r.vehicle_id, provider: r.insurance_provider, policyNumber: r.insurance_policy_number, expireMonth: r.insurance_expire_month },
    ])
  );
}

export async function saveInsurance(vehicleId: string, input: Omit<VehicleInsurance, "vehicleId">): Promise<VehicleInsurance> {
  const { data, error } = await supabase
    .from("vehicle_insurance")
    .upsert(
      {
        vehicle_id: vehicleId,
        insurance_provider: input.provider?.trim() || null,
        insurance_policy_number: input.policyNumber?.trim() || null,
        insurance_expire_month: input.expireMonth?.trim() || null,
      },
      { onConflict: "vehicle_id" }
    )
    .select()
    .single();
  if (error) fail(error);
  const r = data as InsuranceRow;
  return { vehicleId: r.vehicle_id, provider: r.insurance_provider, policyNumber: r.insurance_policy_number, expireMonth: r.insurance_expire_month };
}

/** "YY/MM" → the last day of that month, or null when the text isn't one. */
export function insuranceExpiry(expireMonth: string | null | undefined): Date | null {
  const m = expireMonth?.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(2000 + Number(m[1]), month, 0, 23, 59, 59);
}

/** Days until a policy runs out (negative once it has). */
export function daysUntil(d: Date, now = new Date()): number {
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export interface InsuranceCompany {
  name: string;
  phone: string | null;
}

/** The insurers drivers pick from: public reference data, the same for everyone. */
export async function listInsuranceCompanies(): Promise<InsuranceCompany[]> {
  const { data, error } = await supabase.from("insurance_companies").select("company_name,phone_tel").order("company_name");
  if (error) return [];
  return (data as { company_name: string; phone_tel: string | null }[]).map((r) => ({ name: r.company_name, phone: r.phone_tel }));
}

// ─── Profile (public.profiles, 1:1 with the auth user) ───────────────────

export interface DriverProfile {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  licenceNumber: string | null;
  nicNumber: string | null;
}

export async function getMyProfile(): Promise<DriverProfile> {
  const { data: s } = await supabase.auth.getSession();
  const user = s.session?.user;
  if (!user) throw new VehicleApiError("Not signed in");
  const { data, error } = await supabase.from("profiles").select("name,phone,location,licence_number,nic_number").eq("id", user.id).maybeSingle();
  if (error) fail(error);
  const p = data as { name: string | null; phone: string | null; location: string | null; licence_number: string | null; nic_number: string | null } | null;
  return {
    name: p?.name || (user.user_metadata?.name as string | undefined) || "",
    email: user.email ?? "",
    phone: p?.phone ?? null,
    location: p?.location ?? null,
    licenceNumber: p?.licence_number ?? null,
    nicNumber: p?.nic_number ?? null,
  };
}

export async function updateMyProfile(patch: Omit<DriverProfile, "email">): Promise<DriverProfile> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("profiles")
    .update({
      name: patch.name.trim(),
      phone: patch.phone?.trim() || null,
      location: patch.location?.trim() || null,
      licence_number: patch.licenceNumber?.trim().toUpperCase() || null,
      nic_number: patch.nicNumber?.trim().toUpperCase() || null,
    })
    .eq("id", userId);
  if (error) fail(error);
  return getMyProfile();
}
