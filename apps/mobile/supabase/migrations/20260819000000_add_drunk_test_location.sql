-- Adds entry-location columns for the User Verification Test (drunk-test) step,
-- mirroring the guided_capture_start_* columns already on this table — captured
-- once, at the moment the driver presses record, same pattern as the other steps.

alter table captures
  add column if not exists drunk_test_started_at timestamptz null,
  add column if not exists drunk_test_start_captured_at_display_local text null,
  add column if not exists drunk_test_start_gps_lat double precision null,
  add column if not exists drunk_test_start_gps_lng double precision null,
  add column if not exists drunk_test_start_location_permission text null,
  add column if not exists drunk_test_start_location_label text null;
