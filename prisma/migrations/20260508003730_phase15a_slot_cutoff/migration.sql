-- AlterTable
ALTER TABLE "Slot" ADD COLUMN     "cutoffOffsetMinutes" INTEGER;

-- AlterTable
ALTER TABLE "SlotTemplate" ADD COLUMN     "cutoffOffsetMinutes" INTEGER;
