-- The driver's confirmation that the job was actually fixed.
-- Nullable on purpose: existing rows were never asked, and "not asked" must
-- read as satisfied rather than as a complaint (see services/provider-trust.ts).
ALTER TABLE "dispatch"."resolution_feedbacks" ADD COLUMN "driverConfirmed" BOOLEAN;
