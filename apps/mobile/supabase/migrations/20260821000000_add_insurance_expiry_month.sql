-- Adds the insurance policy's expiry month ("YY/MM", e.g. "26/09") captured on the
-- Add your Insurer screen. Stored on both tables, same pattern as policy_number:
-- vehicle_insurance is the durable per-vehicle record; captures.insurance_expire_month
-- is a point-in-time copy taken at claim-upload time (via createPayload in
-- lib/capture-api.ts). Unlike policy_number, this is NOT relayed into R2 object
-- metadata by sign-photo-upload — the Insurer Dashboard backend reads it with a
-- direct Supabase lookup instead (Insurer-Dashboard/backend/app/services/
-- captures_lookup.py), so it works for already-uploaded claims too.

alter table vehicle_insurance
  add column if not exists insurance_expire_month text null;

alter table captures
  add column if not exists insurance_expire_month text null;
