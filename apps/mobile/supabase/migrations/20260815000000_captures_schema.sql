-- Migrates claims-privacy's captures/capture_photos tables (previously Neon Postgres,
-- app-code-authorized) into this Supabase project, under the same RLS convention
-- already used for vehicles/profiles (auth.uid() = user_id). See
-- components/claims-privacy/app/repository.py::ensure_schema() for the source schema
-- this was ported from — every column here matches that 1:1.

create table if not exists captures (
  -- claims-privacy generated this client-side (uuid4()) since Python owned the insert;
  -- now the client inserts directly, so Postgres generates it instead.
  id uuid primary key default gen_random_uuid(),
  status text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  -- Owner of the capture — the Supabase auth user id. Never null for rows created
  -- through this schema (RLS requires it to match auth.uid() to be reachable at all).
  user_id uuid null,

  claimant_name text null,
  claimant_nic text null,
  claimant_licence_number text null,

  vehicle_model text null,
  policy_number text null,
  vehicle_reg_no text null,

  report_captured_at timestamptz null,
  report_gps_lat double precision null,
  report_gps_lng double precision null,
  report_location_label text null,
  report_captured_at_display_local text null,

  insurer_call_at timestamptz null,
  insurer_call_gps_lat double precision null,
  insurer_call_gps_lng double precision null,
  insurer_call_location_permission text null,
  insurer_call_location_label text null,
  insurer_call_captured_at_display_local text null,

  guided_capture_started_at timestamptz null,
  guided_capture_start_captured_at_display_local text null,
  guided_capture_start_gps_lat double precision null,
  guided_capture_start_gps_lng double precision null,
  guided_capture_start_location_permission text null,
  guided_capture_start_location_label text null
);

create index if not exists captures_user_id_created_at_idx
  on captures (user_id, created_at desc);

create table if not exists capture_photos (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures(id) on delete cascade,
  photo_index integer not null,
  asset_kind text not null default 'original',
  r2_key text not null unique,
  content_type text not null,
  byte_size bigint not null,
  gps_lat double precision null,
  gps_lng double precision null,
  gps_alt double precision null,
  gps_accuracy double precision null,
  captured_at_client timestamptz null,
  received_at_server timestamptz not null default now(),
  unique (capture_id, photo_index, asset_kind)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same convention as vehicles/vehicle_insurance: owner-only via auth.uid(), enforced
-- at the DB layer instead of the hand-written user_id checks claims-privacy's Python
-- code did (_load_owned_capture in main.py). A row with user_id null is unreachable
-- under this policy, same "unreachable by design" behavior as the old code comment.

alter table captures enable row level security;
alter table capture_photos enable row level security;

create policy captures_select_own on captures
  for select using (auth.uid() = user_id);

create policy captures_insert_own on captures
  for insert with check (auth.uid() = user_id);

create policy captures_update_own on captures
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No delete policy — nothing in the app ever deletes a capture today.

-- capture_photos has no user_id column of its own; scope transitively through its
-- parent capture, same pattern as vehicle_insurance -> vehicles.
create policy capture_photos_select_own on capture_photos
  for select using (
    exists (
      select 1 from captures c
      where c.id = capture_photos.capture_id and c.user_id = auth.uid()
    )
  );

create policy capture_photos_insert_own on capture_photos
  for insert with check (
    exists (
      select 1 from captures c
      where c.id = capture_photos.capture_id and c.user_id = auth.uid()
    )
  );

-- Insurer-Dashboard's backend uses a service_role-equivalent key (sb_secret_...),
-- which bypasses RLS entirely — no separate "insurer" policy is needed for its
-- pending_review/approved status writes.
