-- AlterTable
ALTER TABLE "WebhookDestination" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ALTER COLUMN "enabled" SET DEFAULT false;
