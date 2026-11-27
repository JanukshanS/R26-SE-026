-- CreateTable
CREATE TABLE "garage_calls" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'app',
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garage_calls_garage_id_created_at_idx" ON "garage_calls"("garage_id", "created_at");

-- CreateIndex
CREATE INDEX "garage_calls_created_at_idx" ON "garage_calls"("created_at");

-- AddForeignKey
ALTER TABLE "garage_calls" ADD CONSTRAINT "garage_calls_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

