-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('TEXT', 'CHECKLIST');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationKind_new" AS ENUM ('ROUTINE_UPCOMING', 'ROUTINE_DUE', 'ROUTINE_NAG', 'EVENT_AHEAD', 'EVENT_TODAY', 'NOTE_AHEAD', 'NOTE_DUE', 'DAILY_DIGEST');
ALTER TABLE "Notification" ALTER COLUMN "kind" TYPE "NotificationKind_new" USING ("kind"::text::"NotificationKind_new");
ALTER TYPE "NotificationKind" RENAME TO "NotificationKind_old";
ALTER TYPE "NotificationKind_new" RENAME TO "NotificationKind";
DROP TYPE "public"."NotificationKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Todo" DROP CONSTRAINT "Todo_familyId_fkey";

-- DropForeignKey
ALTER TABLE "Todo" DROP CONSTRAINT "Todo_ownerId_fkey";

-- DropTable
DROP TABLE "Todo";

-- DropEnum
DROP TYPE "TodoStatus";

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "kind" "NoteKind" NOT NULL DEFAULT 'TEXT',
    "color" TEXT NOT NULL DEFAULT 'default',
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "remindDate" TEXT,
    "remindAtTime" TEXT NOT NULL DEFAULT '08:00',
    "remindBeforeDays" INTEGER[] DEFAULT ARRAY[1, 0]::INTEGER[],
    "recurIntervalDays" INTEGER,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteItem" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_familyId_archived_idx" ON "Note"("familyId", "archived");

-- CreateIndex
CREATE INDEX "Note_ownerId_archived_idx" ON "Note"("ownerId", "archived");

-- CreateIndex
CREATE INDEX "Note_remindDate_idx" ON "Note"("remindDate");

-- CreateIndex
CREATE INDEX "NoteItem_noteId_idx" ON "NoteItem"("noteId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteItem" ADD CONSTRAINT "NoteItem_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

