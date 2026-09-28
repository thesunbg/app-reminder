-- Ngày âm lặp HÀNG THÁNG: mùng 1, ngày rằm — thứ nhà có bàn thờ phải nhớ nhiều
-- nhất, mà trước đây không khai được vì sự kiện âm lịch chỉ lặp mỗi năm một lần.
ALTER TYPE "CalendarType" ADD VALUE 'LUNAR_MONTHLY';

-- Một sự kiện hàng tháng có 12–13 lần trong cùng một năm âm, nên khoá duy nhất
-- phải là NGÀY chứ không phải năm; khoá cũ khiến chúng ghi đè lẫn nhau.
DROP INDEX "EventOccurrence_eventId_year_key";
CREATE UNIQUE INDEX "EventOccurrence_eventId_solarDate_key" ON "EventOccurrence"("eventId", "solarDate");
CREATE INDEX "EventOccurrence_eventId_year_idx" ON "EventOccurrence"("eventId", "year");
