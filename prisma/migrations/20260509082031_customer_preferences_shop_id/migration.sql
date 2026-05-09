-- AlterTable
ALTER TABLE "CustomerPreferences" ADD COLUMN     "shopId" TEXT;

-- CreateIndex
CREATE INDEX "CustomerPreferences_shopId_idx" ON "CustomerPreferences"("shopId");

-- AddForeignKey
ALTER TABLE "CustomerPreferences" ADD CONSTRAINT "CustomerPreferences_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
