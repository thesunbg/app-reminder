-- Ngày âm lặp HÀNG THÁNG: mùng 1, ngày rằm — thứ nhà có bàn thờ phải nhớ nhiều
-- nhất, mà trước đây không khai được vì sự kiện âm lịch chỉ lặp mỗi năm một lần.
ALTER TYPE "CalendarType" ADD VALUE 'LUNAR_MONTHLY';

-- Dọn trùng TRƯỚC khi đổi khoá, nếu không migration hỏng giữa chừng và container
-- server không khởi động được (migrate deploy nằm ngay trong CMD).
--
-- Trùng (eventId, solarDate) là có thật với dữ liệu cũ: sự kiện MỘT LẦN (chuyến
-- đi) luôn quy ra đúng một ngày, nhưng code cũ khoá theo (eventId, year) và mỗi
-- năm dương lại ghi một hàng mới — sống qua một mốc giao thừa là thành hai hàng
-- cùng ngày. Giữ hàng có `year` lớn nhất (bản tính gần đây nhất).
DELETE FROM "EventOccurrence" a
USING "EventOccurrence" b
WHERE a."eventId" = b."eventId"
  AND a."solarDate" = b."solarDate"
  AND (a."year" < b."year" OR (a."year" = b."year" AND a."id" > b."id"));

-- Một sự kiện hàng tháng có 12–13 lần trong cùng một năm âm, nên khoá duy nhất
-- phải là NGÀY chứ không phải năm; khoá cũ khiến chúng ghi đè lẫn nhau.
DROP INDEX "EventOccurrence_eventId_year_key";
CREATE UNIQUE INDEX "EventOccurrence_eventId_solarDate_key" ON "EventOccurrence"("eventId", "solarDate");
CREATE INDEX "EventOccurrence_eventId_year_idx" ON "EventOccurrence"("eventId", "year");
