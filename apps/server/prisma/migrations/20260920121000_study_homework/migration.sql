-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'HOMEWORK_DUE';

-- AlterTable
ALTER TABLE "StudyRecord" ADD COLUMN     "doneAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StudyRecord_childId_kind_doneAt_idx" ON "StudyRecord"("childId", "kind", "doneAt");
