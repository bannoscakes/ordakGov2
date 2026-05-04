-- AlterTable
ALTER TABLE "Slot" ADD COLUMN     "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "excludePostcodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Slot_zoneId_idx" ON "Slot"("zoneId");

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
