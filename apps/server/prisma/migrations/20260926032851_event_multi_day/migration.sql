-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "endDate" TEXT,
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT;

-- AlterTable
ALTER TABLE "EventOccurrence" ADD COLUMN     "endDate" TEXT;

-- CreateIndex
CREATE INDEX "EventOccurrence_endDate_idx" ON "EventOccurrence"("endDate");
