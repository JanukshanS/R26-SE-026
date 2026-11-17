-- Selling by measure, buying in bigger units and opening packs, store credit
-- and exchanges, warranty claims (with the supplier), return rules, and kits.
-- Only additions: every new column is optional or has a default.

-- CreateEnum
CREATE TYPE "StoreCreditStatus" AS ENUM ('ACTIVE', 'USED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'REPLACED', 'REFUNDED', 'REPAIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierClaimStatus" AS ENUM ('NONE', 'PENDING', 'CREDITED', 'REPLACED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'BREAK_BULK';
ALTER TYPE "StockReason" ADD VALUE 'WARRANTY';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'VOUCHER';

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "next_claim_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "breaks_into_id" TEXT,
ADD COLUMN     "breaks_into_qty" DECIMAL(10,3),
ADD COLUMN     "fractional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_kit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchase_factor" DECIMAL(10,3) NOT NULL DEFAULT 1,
ADD COLUMN     "purchase_unit" TEXT,
ADD COLUMN     "quick_qtys" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "warranty_free_months" INTEGER;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "purchase_unit" TEXT,
ADD COLUMN     "unit_factor" DECIMAL(10,3) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "exchange_of_id" TEXT;

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "store_credit_id" TEXT;

-- CreateTable
CREATE TABLE "kit_components" (
    "id" TEXT NOT NULL,
    "kit_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "kit_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credits" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "StoreCreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "note" TEXT,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_entries" (
    "id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "sale_id" TEXT,
    "return_id" TEXT,
    "method" "PaymentMethod",
    "cash_session_id" TEXT,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "sale_id" TEXT,
    "sale_item_id" TEXT,
    "part_id" TEXT,
    "serial_number" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "fault" TEXT NOT NULL,
    "sold_at" TIMESTAMP(3),
    "warranty_until" TIMESTAMP(3),
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "charged" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "replacement_sale_id" TEXT,
    "refund_return_id" TEXT,
    "outcome_note" TEXT,
    "supplier_id" TEXT,
    "supplier_status" "SupplierClaimStatus" NOT NULL DEFAULT 'NONE',
    "supplier_credit" DECIMAL(12,2),
    "supplier_note" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_by_name" TEXT NOT NULL,
    "resolved_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_rules" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "category" TEXT,
    "returnable" BOOLEAN NOT NULL DEFAULT true,
    "days" INTEGER,
    "fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kit_components_component_id_idx" ON "kit_components"("component_id");

-- CreateIndex
CREATE UNIQUE INDEX "kit_components_kit_id_component_id_key" ON "kit_components"("kit_id", "component_id");

-- CreateIndex
CREATE INDEX "store_credits_shop_id_status_idx" ON "store_credits"("shop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_credits_shop_id_code_key" ON "store_credits"("shop_id", "code");

-- CreateIndex
CREATE INDEX "store_credit_entries_credit_id_idx" ON "store_credit_entries"("credit_id");

-- CreateIndex
CREATE INDEX "store_credit_entries_cash_session_id_idx" ON "store_credit_entries"("cash_session_id");

-- CreateIndex
CREATE INDEX "warranty_claims_shop_id_status_idx" ON "warranty_claims"("shop_id", "status");

-- CreateIndex
CREATE INDEX "warranty_claims_shop_id_supplier_status_idx" ON "warranty_claims"("shop_id", "supplier_status");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_shop_id_number_key" ON "warranty_claims"("shop_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "return_rules_shop_id_category_key" ON "return_rules"("shop_id", "category");

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_breaks_into_id_fkey" FOREIGN KEY ("breaks_into_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credits" ADD CONSTRAINT "store_credits_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "store_credit_entries_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "store_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_rules" ADD CONSTRAINT "return_rules_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

