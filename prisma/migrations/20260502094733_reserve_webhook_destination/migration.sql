-- CreateTable
CREATE TABLE "WebhookDestination" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "eventTypes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDestination_shopId_idx" ON "WebhookDestination"("shopId");

-- AddForeignKey
ALTER TABLE "WebhookDestination" ADD CONSTRAINT "WebhookDestination_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
