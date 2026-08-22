-- Reconstructed schema for two tables that, like `vehicles` and `profiles`, were
-- created directly in the Supabase dashboard rather than through a migration file —
-- no CREATE TABLE for either exists anywhere in this repo's history. Column names/
-- types below are inferred from the actual app code that reads/writes them
-- (lib/vehicleInsuranceApi.ts, lib/insuranceCompaniesApi.ts, and the
-- Insurer-Dashboard backend's admin.py), not copied from a real schema dump —
-- sanity-check against the live project before relying on this for a fresh
-- database (see the verification query in the PR/commit description).
--
-- Earlier timestamp than 20260823000000_captures_and_insurance_schema.sql on
-- purpose: that file ALTERs vehicle_insurance (adds insurance_expire_month,
-- adds the policy-number unique constraint) — those statements need this base
-- table to exist first. Both are idempotent regardless (IF NOT EXISTS / a
-- duplicate_object-swallowing DO block), so actual apply order doesn't matter,
-- but this keeps the sequence readable.

-- ── vehicle_insurance ────────────────────────────────────────────────────────
-- One row per vehicle (lib/vehicleInsuranceApi.ts upserts with onConflict:
-- "vehicle_id", so vehicle_id itself must be the unique/primary key — not a
-- separate id + a unique constraint on vehicle_id).

create table if not exists vehicle_insurance (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  insurance_provider text null,
  insurance_policy_number text null,
  -- Present here (not left for the 20260823 migration to add) since this is the
  -- table's first-ever creation — a fresh table should already have every
  -- column the app currently expects, not need a follow-up ALTER for one of them.
  insurance_expire_month text null
);

alter table vehicle_insurance enable row level security;

-- No user_id column of its own — scoped transitively through its parent vehicle,
-- same pattern already used for capture_photos -> captures.
do $$ begin
  create policy vehicle_insurance_select_own on vehicle_insurance
    for select using (
      exists (select 1 from vehicles v where v.id = vehicle_insurance.vehicle_id and v.user_id = auth.uid())
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy vehicle_insurance_insert_own on vehicle_insurance
    for insert with check (
      exists (select 1 from vehicles v where v.id = vehicle_insurance.vehicle_id and v.user_id = auth.uid())
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy vehicle_insurance_update_own on vehicle_insurance
    for update using (
      exists (select 1 from vehicles v where v.id = vehicle_insurance.vehicle_id and v.user_id = auth.uid())
    ) with check (
      exists (select 1 from vehicles v where v.id = vehicle_insurance.vehicle_id and v.user_id = auth.uid())
    );
exception when duplicate_object then null;
end $$;

-- ── insurance_companies ──────────────────────────────────────────────────────
-- Public reference data, not owned by any one driver — every driver sees the same
-- list (app/(onboarding)/add-insurer.tsx's provider picker), and the
-- Insurer-Dashboard admin backend manages rows via a service-role-equivalent key
-- that bypasses RLS entirely. contact_email/app_name/phone_tel/is_active come
-- from Insurer-Dashboard/backend/app/api/routes/admin.py's CompanyCreate/
-- CompanyOut models — the mobile app only ever reads company_name/app_name/
-- phone_tel, so those three are the ones with real evidence of NOT NULL usage;
-- the rest are left nullable to be safe.

create table if not exists insurance_companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  app_name text null,
  phone_tel text null,
  contact_email text null,
  is_active boolean not null default true
);

alter table insurance_companies enable row level security;

-- Readable by any signed-in driver (no per-user scoping); writes go through the
-- Insurer-Dashboard backend's service-role key, which bypasses RLS, so no
-- insert/update/delete policy is needed here.
do $$ begin
  create policy insurance_companies_select_authenticated on insurance_companies
    for select using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;
