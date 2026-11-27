-- Counter, staff and cash, stocktakes, and what the shop owes its suppliers:
--   staff with roles and an audit trail; cash drawers; split payments and
--   sales on account (garages and the shop's own customers); line discounts,
--   per-part VAT, warranty, core deposits and serial numbers; voids; held
--   sales and quotations; stocktakes; supplier bills, payments and returns.
--
-- Existing sales keep how they were paid: one payment row each, then the old
-- column goes.

-- CreateEnum
CREATE TYPE "SaleLineKind" AS ENUM ('PART', 'OTHER', 'CORE');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('GARAGE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'CASHIER', 'STOREKEEPER');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('PAY_IN', 'PAY_OUT');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('HELD', 'QUOTE');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierEntryKind" AS ENUM ('BILL', 'PAYMENT', 'RETURN', 'ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'STOCKTAKE';
ALTER TYPE "StockReason" ADD VALUE 'VOID';
ALTER TYPE "StockReason" ADD VALUE 'RETURN_TO_SUPPLIER';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT';

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "owner_name" TEXT,
ADD COLUMN     "max_discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 10,
ADD COLUMN     "next_barcode_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "next_count_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "next_quote_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "next_session_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "next_supplier_return_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "owner_pin_hash" TEXT,
ADD COLUMN     "receipt_width" TEXT NOT NULL DEFAULT '80mm',
ADD COLUMN     "require_cash_session" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vat_number" TEXT;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "core_charge" DECIMAL(12,2),
ADD COLUMN     "serialized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tax_rate" DECIMAL(5,2),
ADD COLUMN     "warranty_months" INTEGER;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "by_name" TEXT,
ADD COLUMN     "count_id" TEXT,
ADD COLUMN     "supplier_return_id" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "payment_days" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "approved_by_name" TEXT,
ADD COLUMN     "cashier_name" TEXT,
ADD COLUMN     "cashier_user_id" TEXT,
ADD COLUMN     "customer_address" TEXT,
ADD COLUMN     "customer_vat_no" TEXT,
ADD COLUMN     "draft_id" TEXT,
ADD COLUMN     "tax_invoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_by_name" TEXT;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "SaleLineKind" NOT NULL DEFAULT 'PART',
ADD COLUMN     "list_price" DECIMAL(12,2),
ADD COLUMN     "serial_number" TEXT,
ADD COLUMN     "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "warranty_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "approved_by_name" TEXT,
ADD COLUMN     "by_name" TEXT,
ADD COLUMN     "cash_session_id" TEXT;

-- AlterTable
ALTER TABLE "trade_accounts" ADD COLUMN     "kind" "AccountKind" NOT NULL DEFAULT 'GARAGE',
ALTER COLUMN "garage_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "account_entries" ADD COLUMN     "by_name" TEXT,
ADD COLUMN     "cash_session_id" TEXT,
ADD COLUMN     "sale_id" TEXT;

-- AlterTable
ALTER TABLE "garage_orders" ADD COLUMN     "cash_session_id" TEXT,
ADD COLUMN     "handed_over_by" TEXT;

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "cash_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_staff" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL,
    "pin_hash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float" DECIMAL(12,2) NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "closed_by_name" TEXT,
    "expected_cash" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "note" TEXT,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_drafts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "kind" "DraftKind" NOT NULL,
    "number" INTEGER,
    "status" "DraftStatus" NOT NULL DEFAULT 'OPEN',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "plate" TEXT,
    "input" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "created_by_name" TEXT NOT NULL,
    "sale_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT,
    "location" TEXT,
    "note" TEXT,
    "created_by_name" TEXT NOT NULL,
    "posted_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "expected_qty" DECIMAL(10,2) NOT NULL,
    "stock_at_count" DECIMAL(10,2),
    "counted_qty" DECIMAL(10,2),
    "counted_at" TIMESTAMP(3),
    "counted_by_name" TEXT,
    "adjustment" DECIMAL(10,2),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_entries" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "kind" "SupplierEntryKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "bill_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "purchase_id" TEXT,
    "return_id" TEXT,
    "method" "PaymentMethod",
    "cash_session_id" TEXT,
    "note" TEXT,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "purchase_id" TEXT,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

-- CreateIndex
CREATE INDEX "sale_payments_cash_session_id_idx" ON "sale_payments"("cash_session_id");

-- CreateIndex
CREATE INDEX "shop_staff_user_id_idx" ON "shop_staff"("user_id");

-- CreateIndex
CREATE INDEX "shop_staff_email_idx" ON "shop_staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "shop_staff_shop_id_email_key" ON "shop_staff"("shop_id", "email");

-- CreateIndex
CREATE INDEX "audit_events_shop_id_created_at_idx" ON "audit_events"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_shop_id_action_idx" ON "audit_events"("shop_id", "action");

-- CreateIndex
CREATE INDEX "cash_sessions_shop_id_user_id_status_idx" ON "cash_sessions"("shop_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_shop_id_opened_at_idx" ON "cash_sessions"("shop_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_shop_id_number_key" ON "cash_sessions"("shop_id", "number");

-- CreateIndex
CREATE INDEX "cash_movements_session_id_idx" ON "cash_movements"("session_id");

-- CreateIndex
CREATE INDEX "sale_drafts_shop_id_kind_status_idx" ON "sale_drafts"("shop_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sale_drafts_shop_id_kind_number_key" ON "sale_drafts"("shop_id", "kind", "number");

-- CreateIndex
CREATE INDEX "stock_counts_shop_id_status_idx" ON "stock_counts"("shop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_shop_id_number_key" ON "stock_counts"("shop_id", "number");

-- CreateIndex
CREATE INDEX "stock_count_lines_part_id_idx" ON "stock_count_lines"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_part_id_key" ON "stock_count_lines"("count_id", "part_id");

-- CreateIndex
CREATE INDEX "supplier_entries_supplier_id_created_at_idx" ON "supplier_entries"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_entries_shop_id_kind_idx" ON "supplier_entries"("shop_id", "kind");

-- CreateIndex
CREATE INDEX "supplier_returns_supplier_id_idx" ON "supplier_returns"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_shop_id_number_key" ON "supplier_returns"("shop_id", "number");

-- CreateIndex
CREATE INDEX "sales_shop_id_customer_phone_idx" ON "sales"("shop_id", "customer_phone");

-- CreateIndex
CREATE INDEX "sales_account_id_idx" ON "sales"("account_id");

-- CreateIndex
CREATE INDEX "sale_items_serial_number_idx" ON "sale_items"("serial_number");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trade_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_orders" ADD CONSTRAINT "garage_orders_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_staff" ADD CONSTRAINT "shop_staff_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_drafts" ADD CONSTRAINT "sale_drafts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every existing sale was paid in full by one method.
INSERT INTO "sale_payments" ("id", "sale_id", "method", "amount", "created_at")
SELECT gen_random_uuid()::text, "id", "payment_method", "total", "created_at" FROM "sales";
UPDATE "sale_items" SET "list_price" = "unit_price";
UPDATE "sale_items" SET "kind" = 'OTHER' WHERE "part_id" IS NULL;
ALTER TABLE "sales" DROP COLUMN "payment_method";
