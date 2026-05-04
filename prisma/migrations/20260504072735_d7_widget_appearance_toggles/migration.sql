-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "showMostAvailableBadge" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showRecommendedBadge" BOOLEAN NOT NULL DEFAULT false;
