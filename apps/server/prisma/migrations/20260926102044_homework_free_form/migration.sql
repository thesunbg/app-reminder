-- AlterTable
ALTER TABLE "StudyRecord" ALTER COLUMN "subject" DROP NOT NULL,
ALTER COLUMN "date" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StudyAttachment" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyAttachment_recordId_idx" ON "StudyAttachment"("recordId");

-- AddForeignKey
ALTER TABLE "StudyAttachment" ADD CONSTRAINT "StudyAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "StudyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
