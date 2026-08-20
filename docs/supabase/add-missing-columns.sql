-- Columns the mobile app reads/writes that are missing from the Supabase
-- schema. The app side landed in "Add per-vehicle insurance details for
-- onboarding and vehicle management"; these were never added to the database,
-- so inserting a vehicle fails with:
--   Could not find the 'insurance_policy_number' column of 'vehicles'
--
-- Safe to re-run: every statement is IF NOT EXISTS and additive. Run in
-- Supabase Studio -> SQL Editor.

-- Per-vehicle insurance (a driver's two cars can have different insurers)
alter table public.vehicles
  add column if not exists insurance_provider      text,
  add column if not exists insurance_policy_number text;

-- Driver identity fields shown on the same form
alter table public.profiles
  add column if not exists licence_number text,
  add column if not exists nic_number     text,
  add column if not exists location       text,
  add column if not exists provider_id    uuid;

-- PostgREST caches the schema; adding a column normally invalidates it
-- automatically, but force it so the app doesn't keep seeing the stale cache.
notify pgrst, 'reload schema';
