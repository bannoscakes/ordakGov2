-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "blackoutDates" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[];
