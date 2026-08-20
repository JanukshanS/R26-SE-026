-- Enforces uniqueness for the three fields on the Add your Insurer screen: NIC Number
-- and Driving Licence Number (profiles — one real person shouldn't be able to register
-- twice under the same identity), and Policy Number (vehicle_insurance — one policy
-- shouldn't be attached to more than one vehicle). Plain unique constraints; NULLs are
-- unaffected (Postgres allows any number of NULLs under a unique constraint), which
-- matters since all three fields are optional.
--
-- NOTE: if any existing rows already share a duplicate value, this ALTER TABLE will
-- fail validation and needs those duplicates resolved manually first — this migration
-- doesn't touch or delete any existing data itself.

alter table profiles
  add constraint profiles_nic_number_key unique (nic_number);

alter table profiles
  add constraint profiles_licence_number_key unique (licence_number);

alter table vehicle_insurance
  add constraint vehicle_insurance_policy_number_key unique (insurance_policy_number);
