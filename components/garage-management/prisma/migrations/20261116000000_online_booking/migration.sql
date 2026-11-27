-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('STAFF', 'ONLINE');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "public_token" TEXT,
ADD COLUMN     "source" "AppointmentSource" NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "garages" ADD COLUMN     "booking_settings" JSONB,
ADD COLUMN     "booking_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_public_token_key" ON "appointments"("public_token");

-- CreateIndex
CREATE UNIQUE INDEX "garages_booking_token_key" ON "garages"("booking_token");

