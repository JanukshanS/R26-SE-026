-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('NOT_CHECKED', 'OK', 'ATTENTION', 'URGENT');

-- CreateEnum
CREATE TYPE "Approval" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "garages" ADD COLUMN     "bank_details" TEXT,
ADD COLUMN     "brand_color" VARCHAR(7),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "invoice_footer" TEXT,
ADD COLUMN     "invoice_terms" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "registration_no" TEXT;

-- AlterTable
ALTER TABLE "job_cards" ADD COLUMN     "mechanic_id" TEXT,
ADD COLUMN     "tracking_token" TEXT;

-- Existing jobs get a random tracking token (32 hex characters; new ones are 22-character base64url).
UPDATE "job_cards" SET "tracking_token" = replace(gen_random_uuid()::text, '-', '') WHERE "tracking_token" IS NULL;
ALTER TABLE "job_cards" ALTER COLUMN "tracking_token" SET NOT NULL;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "supplier_id" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "supplier_id" TEXT,
ADD COLUMN     "unit_cost" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" TEXT,
    "invite_code" TEXT,
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_updates" (
    "id" TEXT NOT NULL,
    "job_card_id" TEXT NOT NULL,
    "status" "JobStatus",
    "note" TEXT,
    "author" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "job_card_id" TEXT NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_items" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL DEFAULT 'NOT_CHECKED',
    "note" TEXT,
    "estimate" DECIMAL(12,2),
    "approval" "Approval",
    "decided_at" TIMESTAMP(3),
    "job_item_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "vehicle_id" TEXT,
    "customer_name" TEXT,
    "phone" TEXT,
    "plate" TEXT,
    "service" TEXT NOT NULL,
    "notes" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "mechanic_id" TEXT,
    "job_card_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_user_id_key" ON "staff_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_invite_code_key" ON "staff_members"("invite_code");

-- CreateIndex
CREATE INDEX "staff_members_garage_id_idx" ON "staff_members"("garage_id");

-- CreateIndex
CREATE INDEX "job_updates_job_card_id_created_at_idx" ON "job_updates"("job_card_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_job_card_id_key" ON "inspections"("job_card_id");

-- CreateIndex
CREATE INDEX "inspections_garage_id_status_idx" ON "inspections"("garage_id", "status");

-- CreateIndex
CREATE INDEX "inspection_items_inspection_id_sort_order_idx" ON "inspection_items"("inspection_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_job_card_id_key" ON "appointments"("job_card_id");

-- CreateIndex
CREATE INDEX "appointments_garage_id_starts_at_idx" ON "appointments"("garage_id", "starts_at");

-- CreateIndex
CREATE INDEX "suppliers_garage_id_name_idx" ON "suppliers"("garage_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_tracking_token_key" ON "job_cards"("tracking_token");

-- CreateIndex
CREATE INDEX "job_cards_garage_id_mechanic_id_idx" ON "job_cards"("garage_id", "mechanic_id");

-- CreateIndex
CREATE INDEX "stock_movements_supplier_id_created_at_idx" ON "stock_movements"("supplier_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_updates" ADD CONSTRAINT "job_updates_job_card_id_fkey" FOREIGN KEY ("job_card_id") REFERENCES "job_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_job_card_id_fkey" FOREIGN KEY ("job_card_id") REFERENCES "job_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_card_id_fkey" FOREIGN KEY ("job_card_id") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Start each existing job's timeline with its current status.
INSERT INTO "job_updates" ("id", "job_card_id", "status", "public", "created_at")
SELECT gen_random_uuid()::text, "id", "status", true, "created_at" FROM "job_cards";
