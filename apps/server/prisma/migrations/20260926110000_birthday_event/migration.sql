-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "birthdayUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_birthdayUserId_key" ON "Event"("birthdayUserId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_birthdayUserId_fkey" FOREIGN KEY ("birthdayUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Những người đã khai ngày sinh từ trước cũng phải có sinh nhật trên lịch ngay,
-- không đợi tới lần sửa hồ sơ tiếp theo. Occurrence và lịch nhắc do
-- materializeEventOccurrences/materializeEvents sinh ra ở lần chạy nền kế tiếp
-- (mỗi vài phút), nên ở đây chỉ cần tạo Event.
INSERT INTO "Event" (
  "id", "familyId", "title", "type", "calendar", "solarDate", "yearly",
  "remindBeforeDays", "remindAtTime", "birthdayUserId", "createdAt"
)
SELECT
  'bday_' || u."id",
  u."familyId",
  'Sinh nhật ' || u."name",
  'BIRTHDAY'::"EventType",
  'SOLAR'::"CalendarType",
  u."birthday",
  true,
  ARRAY[7, 1, 0],
  '08:00',
  u."id",
  NOW()
FROM "User" u
WHERE u."birthday" IS NOT NULL AND u."active" = true;
