-- CreateEnum
CREATE TYPE "PartOrderStatus" AS ENUM ('REQUESTED', 'QUOTED', 'CONFIRMED', 'READY', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PickupBy" AS ENUM ('MECHANIC', 'VEHICLE_OWNER');

-- CreateTable
CREATE TABLE "part_sellers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "delivers" BOOLEAN NOT NULL DEFAULT true,
    "delivery_note" TEXT,
    "opening_hours" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_order_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_listings" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "part_number" TEXT,
    "category" TEXT,
    "fits_models" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stock_qty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_sellers" (
    "garage_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_sellers_pkey" PRIMARY KEY ("garage_id","seller_id")
);

-- CreateTable
CREATE TABLE "part_orders" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "garage_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "job_card_id" TEXT,
    "status" "PartOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "fulfilment" "Fulfilment" NOT NULL,
    "delivery_address" TEXT,
    "pickup_by" "PickupBy",
    "pickup_staff_id" TEXT,
    "pickup_plate" TEXT,
    "handover_code" TEXT NOT NULL,
    "note" TEXT,
    "seller_note" TEXT,
    "quoted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "description" TEXT NOT NULL,
    "part_number" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "job_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "part_sellers_user_id_key" ON "part_sellers"("user_id");

-- CreateIndex
CREATE INDEX "part_sellers_active_city_idx" ON "part_sellers"("active", "city");

-- CreateIndex
CREATE INDEX "seller_listings_seller_id_name_idx" ON "seller_listings"("seller_id", "name");

-- CreateIndex
CREATE INDEX "garage_sellers_seller_id_idx" ON "garage_sellers"("seller_id");

-- CreateIndex
CREATE INDEX "part_orders_garage_id_status_idx" ON "part_orders"("garage_id", "status");

-- CreateIndex
CREATE INDEX "part_orders_seller_id_status_idx" ON "part_orders"("seller_id", "status");

-- CreateIndex
CREATE INDEX "part_orders_job_card_id_idx" ON "part_orders"("job_card_id");

-- CreateIndex
CREATE INDEX "part_orders_pickup_staff_id_idx" ON "part_orders"("pickup_staff_id");

-- CreateIndex
CREATE INDEX "part_orders_pickup_plate_idx" ON "part_orders"("pickup_plate");

-- CreateIndex
CREATE UNIQUE INDEX "part_orders_seller_id_number_key" ON "part_orders"("seller_id", "number");

-- CreateIndex
CREATE INDEX "part_order_items_order_id_idx" ON "part_order_items"("order_id");

-- AddForeignKey
ALTER TABLE "seller_listings" ADD CONSTRAINT "seller_listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "part_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_sellers" ADD CONSTRAINT "garage_sellers_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_sellers" ADD CONSTRAINT "garage_sellers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "part_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "part_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_job_card_id_fkey" FOREIGN KEY ("job_card_id") REFERENCES "job_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_pickup_staff_id_fkey" FOREIGN KEY ("pickup_staff_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_order_items" ADD CONSTRAINT "part_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "part_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_order_items" ADD CONSTRAINT "part_order_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "seller_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
