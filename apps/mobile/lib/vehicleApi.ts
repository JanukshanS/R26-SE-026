import { supabase } from "@lib/supabase";

/**
 * Vehicles + profile data access, backed by Supabase Postgres (RLS-protected:
 * every row is scoped to the signed-in user by `auth.uid()`). Replaces the old
 * Express/Prisma vehicle-service calls. The mobile `User`/`Vehicle` shapes are
 * unchanged so the screens that consume them don't move.
 */

export interface User {
  _id: string;
  name: string;
  email: string;
  role?: string;
  phone?: string;
  // Set once a provider account is linked to its dispatch provider record.
  providerId?: string | null;
  location?: string;
  licenceNumber?: string;
  nicNumber?: string;
}

export interface Vehicle {
  _id: string;
  userId: string;
  nickname?: string;
  make: string;
  model: string;
  year?: number;
  plateNumber: string;
  color?: string;
  currentMileage: number;
  fuelType: "petrol" | "diesel" | "hybrid" | "electric";
  isDefault: boolean;
  createdAt: string;
  // Insurance is per-vehicle (a driver's two cars can have different insurers/policies).
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
}

export type VehicleInput = Omit<Vehicle, "_id" | "userId" | "createdAt">;

export class VehicleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VehicleApiError";
  }
}

// ── Row <-> app-shape mappers (DB is snake_case, app is camelCase) ──────────

interface VehicleRow {
  id: string;
  user_id: string;
  nickname: string | null;
  make: string;
  model: string;
  year: number | null;
  plate_number: string;
  color: string | null;
  current_mileage: number;
  fuel_type: string;
  is_default: boolean;
  created_at: string;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
}

function mapVehicle(r: VehicleRow): Vehicle {
  return {
    _id: r.id,
    userId: r.user_id,
    nickname: r.nickname ?? undefined,
    make: r.make,
    model: r.model,
    year: r.year ?? undefined,
    plateNumber: r.plate_number,
    color: r.color ?? undefined,
    currentMileage: r.current_mileage,
    fuelType: (r.fuel_type as Vehicle["fuelType"]) ?? "petrol",
    isDefault: r.is_default,
    createdAt: r.created_at,
    insuranceProvider: r.insurance_provider ?? undefined,
    insurancePolicyNumber: r.insurance_policy_number ?? undefined,
  };
}

function toRow(data: Partial<VehicleInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.nickname !== undefined) row.nickname = data.nickname || null;
  if (data.make !== undefined) row.make = data.make;
  if (data.model !== undefined) row.model = data.model;
  if (data.year !== undefined) row.year = data.year ?? null;
  if (data.plateNumber !== undefined) row.plate_number = data.plateNumber;
  if (data.color !== undefined) row.color = data.color || null;
  if (data.currentMileage !== undefined) row.current_mileage = data.currentMileage;
  if (data.fuelType !== undefined) row.fuel_type = data.fuelType;
  if (data.isDefault !== undefined) row.is_default = data.isDefault;
  if (data.insuranceProvider !== undefined) row.insurance_provider = data.insuranceProvider || null;
  if (data.insurancePolicyNumber !== undefined)
    row.insurance_policy_number = data.insurancePolicyNumber || null;
  return row;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new VehicleApiError("Not authenticated");
  return id;
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new VehicleApiError(error.message);
  return data as T;
}

// ── Vehicles ────────────────────────────────────────────────────────────────

export async function getVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new VehicleApiError(error.message);
  return (data as VehicleRow[]).map(mapVehicle);
}

export async function createVehicle(data: Partial<VehicleInput>): Promise<Vehicle> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("vehicles")
      .insert({ ...toRow(data), user_id: userId })
      .select()
      .single()
  ) as VehicleRow;
  if (row.is_default) await clearOtherDefaults(userId, row.id);
  return mapVehicle(row);
}

export async function updateVehicle(id: string, data: Partial<VehicleInput>): Promise<Vehicle> {
  const row = unwrap(
    await supabase.from("vehicles").update(toRow(data)).eq("id", id).select().single()
  ) as VehicleRow;
  if (row.is_default) await clearOtherDefaults(row.user_id, row.id);
  return mapVehicle(row);
}

export async function deleteVehicle(id: string): Promise<{ deleted: boolean; id: string }> {
  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) throw new VehicleApiError(error.message);
  return { deleted: true, id };
}

export async function setDefaultVehicle(id: string): Promise<Vehicle> {
  const userId = await currentUserId();
  await clearOtherDefaults(userId, id);
  const row = unwrap(
    await supabase.from("vehicles").update({ is_default: true }).eq("id", id).select().single()
  ) as VehicleRow;
  return mapVehicle(row);
}

/** Keep a single default per user: clear is_default on every row except `keepId`. */
async function clearOtherDefaults(userId: string, keepId: string): Promise<void> {
  await supabase
    .from("vehicles")
    .update({ is_default: false })
    .eq("user_id", userId)
    .neq("id", keepId);
}

// ── Profile (the public.profiles row, 1:1 with auth.users) ───────────────────

interface ProfileRow {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  provider_id: string | null;
  location: string | null;
  licence_number: string | null;
  nic_number: string | null;
}

/** Compose the app `User` from the auth session + the profile row. */
export async function getMyUser(): Promise<User | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) throw new VehicleApiError(error.message);
  const p = data as ProfileRow | null;
  return {
    _id: session.user.id,
    email: session.user.email ?? "",
    name: p?.name || (session.user.user_metadata?.name as string) || "",
    role: p?.role ?? "driver",
    phone: p?.phone ?? undefined,
    providerId: p?.provider_id ?? null,
    location: p?.location ?? undefined,
    licenceNumber: p?.licence_number ?? undefined,
    nicNumber: p?.nic_number ?? undefined,
  };
}

export interface ProfileUpdate {
  name?: string;
  phone?: string;
  location?: string;
  providerId?: string | null;
  licenceNumber?: string;
  nicNumber?: string;
}

export async function updateMyProfile(patch: ProfileUpdate): Promise<User> {
  const userId = await currentUserId();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (patch.location !== undefined) row.location = patch.location || null;
  if (patch.providerId !== undefined) row.provider_id = patch.providerId;
  if (patch.licenceNumber !== undefined) row.licence_number = patch.licenceNumber || null;
  if (patch.nicNumber !== undefined) row.nic_number = patch.nicNumber || null;
  const { error } = await supabase.from("profiles").update(row).eq("id", userId);
  if (error) throw new VehicleApiError(error.message);
  const user = await getMyUser();
  if (!user) throw new VehicleApiError("Not authenticated");
  return user;
}
