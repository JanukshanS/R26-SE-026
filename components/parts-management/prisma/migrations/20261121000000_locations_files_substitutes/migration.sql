-- Stock by location, part files, substitutes, tags and specifications.
--
-- Every part's stock now sits at one or more locations (part_stock); the
-- part's stock_qty stays their sum. Existing parts move to a location named
-- after their old shelf text, or "Main" when they had none, with all their
-- stock there, and that becomes their default location.

-- CreateEnum
CREATE TYPE "PartFileKind" AS ENUM ('IMAGE', 'DOCUMENT', 'LINK');

-- CreateEnum
CREATE TYPE "PartFileStatus" AS ENUM ('PENDING', 'READY');

-- AlterEnum
ALTER TYPE "StockReason" ADD VALUE 'MOVE';

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_stock" (
    "part_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_stock_pkey" PRIMARY KEY ("part_id","location_id")
);

-- CreateTable
CREATE TABLE "part_files" (
    "id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "kind" "PartFileKind" NOT NULL,
    "status" "PartFileStatus" NOT NULL DEFAULT 'READY',
    "name" TEXT NOT NULL,
    "url" TEXT,
    "storage_key" TEXT,
    "content_type" TEXT,
    "size" INTEGER,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_substitutes" (
    "id" TEXT NOT NULL,
    "part_id" TEXT NOT NULL,
    "substitute_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_substitutes_pkey" PRIMARY KEY ("id")
);

-- AlterTable: new part fields (default location filled in below)
ALTER TABLE "parts" ADD COLUMN     "default_location_id" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "specs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "specs_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "location_id" TEXT,
ADD COLUMN     "location_name" TEXT;

-- AlterTable (filled in below)
ALTER TABLE "stock_count_lines" ADD COLUMN     "location_id" TEXT;

-- Backfill: a location per shelf name a shop used ("Main" for none) ...
INSERT INTO "locations" ("id", "shop_id", "name")
SELECT gen_random_uuid()::text, "shop_id", COALESCE(NULLIF(btrim("location"), ''), 'Main')
FROM "parts"
GROUP BY "shop_id", COALESCE(NULLIF(btrim("location"), ''), 'Main');

-- ... each part's default location ...
UPDATE "parts" p SET "default_location_id" = l."id"
FROM "locations" l
WHERE l."shop_id" = p."shop_id" AND l."name" = COALESCE(NULLIF(btrim(p."location"), ''), 'Main');

-- ... all its stock there ...
INSERT INTO "part_stock" ("part_id", "location_id", "qty")
SELECT "id", "default_location_id", "stock_qty" FROM "parts";

-- ... and stocktake lines counted it there.
UPDATE "stock_count_lines" c SET "location_id" = p."default_location_id"
FROM "parts" p WHERE p."id" = c."part_id";

ALTER TABLE "parts" ALTER COLUMN "default_location_id" SET NOT NULL;
ALTER TABLE "parts" DROP COLUMN "location";
ALTER TABLE "stock_count_lines" ALTER COLUMN "location_id" SET NOT NULL;

-- DropIndex
DROP INDEX "stock_count_lines_count_id_part_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "locations_shop_id_name_key" ON "locations"("shop_id", "name");

-- CreateIndex
CREATE INDEX "part_stock_location_id_idx" ON "part_stock"("location_id");

-- CreateIndex
CREATE INDEX "part_files_part_id_idx" ON "part_files"("part_id");

-- CreateIndex
CREATE INDEX "part_substitutes_substitute_id_idx" ON "part_substitutes"("substitute_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_substitutes_part_id_substitute_id_key" ON "part_substitutes"("part_id", "substitute_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_part_id_location_id_key" ON "stock_count_lines"("count_id", "part_id", "location_id");

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_stock" ADD CONSTRAINT "part_stock_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_stock" ADD CONSTRAINT "part_stock_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_files" ADD CONSTRAINT "part_files_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_substitutes" ADD CONSTRAINT "part_substitutes_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_substitutes" ADD CONSTRAINT "part_substitutes_substitute_id_fkey" FOREIGN KEY ("substitute_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
