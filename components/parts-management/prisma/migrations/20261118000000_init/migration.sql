-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'GARAGE_ORDER', 'RETURN', 'ADJUSTMENT', 'DAMAGED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('CHARGE', 'PAYMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('REQUESTED', 'QUOTED', 'CONFIRMED', 'READY', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PickupBy" AS ENUM ('MECHANIC', 'VEHICLE_OWNER');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('ACCOUNT', 'ON_HANDOVER');

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "registration_no" TEXT,
    "opening_hours" TEXT,
    "delivers" BOOLEAN NOT NULL DEFAULT true,
    "delivery_note" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "receipt_footer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_sale_number" INTEGER NOT NULL DEFAULT 1,
    "next_order_number" INTEGER NOT NULL DEFAULT 1,
    "next_purchase_number" INTEGER NOT NULL DEFAULT 1,
    "next_return_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "oem_number" TEXT,
    "part_number" TEXT,
    "cross_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "barcode" TEXT,
    "location" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "retail_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "trade_price" DECIMAL(12,2),
    "stock_qty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reorder_level" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reorder_qty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "universal" BOOLEAN NOT NULL DEFAULT false,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supplier_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_fitments" (
    "id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "note" TEXT,

    CONSTRAINT "part_fitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "quantity_change" DECIMAL(10,2) NOT NULL,
    "reason" "StockReason" NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "sale_id" TEXT,
    "return_id" TEXT,
    "purchase_id" TEXT,
    "order_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_at" TIMESTAMP(3),
    "note" TEXT,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "line" INTEGER NOT NULL DEFAULT 0,
    "part_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "received_qty" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "plate" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "tendered" DECIMAL(12,2),
    "note" TEXT,
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "line" INTEGER NOT NULL DEFAULT 0,
    "part_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "refund_method" "PaymentMethod" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_accounts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "garage_name" TEXT NOT NULL,
    "garage_phone" TEXT,
    "garage_address" TEXT,
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_days" INTEGER NOT NULL DEFAULT 30,
    "on_hold" BOOLEAN NOT NULL DEFAULT false,
    "linked" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "order_id" TEXT,
    "method" "PaymentMethod",
    "reference" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "job_card_id" TEXT,
    "job_number" INTEGER,
    "vehicle_plate" TEXT,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "vehicle_year" INTEGER,
    "fulfilment" "Fulfilment" NOT NULL,
    "delivery_address" TEXT,
    "pickup_by" "PickupBy",
    "pickup_staff_id" TEXT,
    "pickup_user_id" TEXT,
    "pickup_name" TEXT,
    "pickup_phone" TEXT,
    "pickup_plate" TEXT,
    "handover_code" TEXT NOT NULL,
    "payment_terms" "PaymentTerms",
    "paid_at" TIMESTAMP(3),
    "payment_method" "PaymentMethod",
    "note" TEXT,
    "seller_note" TEXT,
    "quoted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "job_sync" TEXT NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garage_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line" INTEGER NOT NULL DEFAULT 0,
    "part_id" TEXT,
    "description" TEXT NOT NULL,
    "part_number" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_owner_user_id_key" ON "shops"("owner_user_id");

-- CreateIndex
CREATE INDEX "shops_active_city_idx" ON "shops"("active", "city");

-- CreateIndex
CREATE INDEX "parts_shop_id_name_idx" ON "parts"("shop_id", "name");

-- CreateIndex
CREATE INDEX "parts_shop_id_oem_number_idx" ON "parts"("shop_id", "oem_number");

-- CreateIndex
CREATE INDEX "parts_shop_id_part_number_idx" ON "parts"("shop_id", "part_number");

-- CreateIndex
CREATE UNIQUE INDEX "parts_shop_id_sku_key" ON "parts"("shop_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "parts_shop_id_barcode_key" ON "parts"("shop_id", "barcode");

-- CreateIndex
CREATE INDEX "part_fitments_part_id_idx" ON "part_fitments"("part_id");

-- CreateIndex
CREATE INDEX "part_fitments_make_model_idx" ON "part_fitments"("make", "model");

-- CreateIndex
CREATE INDEX "stock_movements_part_id_created_at_idx" ON "stock_movements"("part_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_shop_id_created_at_idx" ON "stock_movements"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "suppliers_shop_id_name_idx" ON "suppliers"("shop_id", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_shop_id_status_idx" ON "purchase_orders"("shop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_shop_id_number_key" ON "purchase_orders"("shop_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_id_idx" ON "purchase_order_items"("purchase_id");

-- CreateIndex
CREATE INDEX "sales_shop_id_created_at_idx" ON "sales"("shop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_shop_id_number_key" ON "sales"("shop_id", "number");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_shop_id_number_key" ON "sale_returns"("shop_id", "number");

-- CreateIndex
CREATE INDEX "trade_accounts_garage_id_idx" ON "trade_accounts"("garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_accounts_shop_id_garage_id_key" ON "trade_accounts"("shop_id", "garage_id");

-- CreateIndex
CREATE INDEX "account_entries_account_id_created_at_idx" ON "account_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "garage_orders_shop_id_status_idx" ON "garage_orders"("shop_id", "status");

-- CreateIndex
CREATE INDEX "garage_orders_garage_id_status_idx" ON "garage_orders"("garage_id", "status");

-- CreateIndex
CREATE INDEX "garage_orders_job_card_id_idx" ON "garage_orders"("job_card_id");

-- CreateIndex
CREATE INDEX "garage_orders_pickup_user_id_idx" ON "garage_orders"("pickup_user_id");

-- CreateIndex
CREATE INDEX "garage_orders_pickup_plate_idx" ON "garage_orders"("pickup_plate");

-- CreateIndex
CREATE INDEX "garage_orders_job_sync_idx" ON "garage_orders"("job_sync");

-- CreateIndex
CREATE UNIQUE INDEX "garage_orders_shop_id_number_key" ON "garage_orders"("shop_id", "number");

-- CreateIndex
CREATE INDEX "garage_order_items_order_id_idx" ON "garage_order_items"("order_id");

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trade_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_orders" ADD CONSTRAINT "garage_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_orders" ADD CONSTRAINT "garage_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trade_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_order_items" ADD CONSTRAINT "garage_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "garage_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_order_items" ADD CONSTRAINT "garage_order_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
