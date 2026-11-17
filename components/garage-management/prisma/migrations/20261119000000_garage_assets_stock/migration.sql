-- CreateEnum
CREATE TYPE "PartKind" AS ENUM ('PART', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('GOOD', 'FAIR', 'NEEDS_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetLogType" AS ENUM ('CHECK_OUT', 'CHECK_IN', 'SERVICE', 'CONDITION', 'NOTE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HeldStatus" AS ENUM ('HELD', 'FITTED', 'RETURNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'WORKSHOP_USE';
ALTER TYPE "StockReason" ADD VALUE 'COUNT';

-- AlterTable
ALTER TABLE "garages" ADD COLUMN     "next_purchase_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "kind" "PartKind" NOT NULL DEFAULT 'PART',
ADD COLUMN     "location_id" TEXT;

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "note" TEXT,
    "counted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "expected" DECIMAL(10,2) NOT NULL,
    "counted" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "received_qty" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "category" TEXT,
    "serial_no" TEXT,
    "purchase_date" DATE,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "location_id" TEXT,
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "held_by_id" TEXT,
    "checked_out_at" TIMESTAMP(3),
    "service_interval_days" INTEGER,
    "next_service_due" DATE,
    "warranty_until" DATE,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_logs" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "type" "AssetLogType" NOT NULL,
    "staff_name" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_items" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "customer_id" TEXT,
    "vehicle_id" TEXT,
    "job_card_id" TEXT,
    "location_id" TEXT,
    "status" "HeldStatus" NOT NULL DEFAULT 'HELD',
    "note" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "held_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_garage_id_name_key" ON "stock_locations"("garage_id", "name");

-- CreateIndex
CREATE INDEX "stock_counts_garage_id_created_at_idx" ON "stock_counts"("garage_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_count_lines_count_id_idx" ON "stock_count_lines"("count_id");

-- CreateIndex
CREATE INDEX "purchase_orders_garage_id_status_idx" ON "purchase_orders"("garage_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_garage_id_number_key" ON "purchase_orders"("garage_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_order_id_idx" ON "purchase_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "assets_garage_id_active_idx" ON "assets"("garage_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "assets_garage_id_tag_key" ON "assets"("garage_id", "tag");

-- CreateIndex
CREATE INDEX "asset_logs_asset_id_created_at_idx" ON "asset_logs"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "held_items_garage_id_status_idx" ON "held_items"("garage_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parts_garage_id_barcode_key" ON "parts"("garage_id", "barcode");

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_held_by_id_fkey" FOREIGN KEY ("held_by_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_logs" ADD CONSTRAINT "asset_logs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_items" ADD CONSTRAINT "held_items_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_items" ADD CONSTRAINT "held_items_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_items" ADD CONSTRAINT "held_items_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_items" ADD CONSTRAINT "held_items_job_card_id_fkey" FOREIGN KEY ("job_card_id") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_items" ADD CONSTRAINT "held_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

