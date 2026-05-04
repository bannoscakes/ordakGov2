-- CreateTable
CREATE TABLE "SlotTemplate" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT,
    "locationId" TEXT NOT NULL,
    "fulfillmentType" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "timeStart" TEXT NOT NULL,
    "timeEnd" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlotTemplate_zoneId_idx" ON "SlotTemplate"("zoneId");

-- CreateIndex
CREATE INDEX "SlotTemplate_locationId_idx" ON "SlotTemplate"("locationId");

-- CreateIndex
CREATE INDEX "SlotTemplate_dayOfWeek_idx" ON "SlotTemplate"("dayOfWeek");

-- AddForeignKey
ALTER TABLE "SlotTemplate" ADD CONSTRAINT "SlotTemplate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotTemplate" ADD CONSTRAINT "SlotTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
