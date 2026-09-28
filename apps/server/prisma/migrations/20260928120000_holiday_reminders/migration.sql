-- Công tắc nhắc lễ tết Việt Nam. Bật sẵn: danh mục chỉ nhắc những ngày thật sự
-- phải chuẩn bị (Tết, Ông Táo, Trung Thu, 20/11...) nên vài chục thông báo cả
-- năm, còn tắt sẵn thì tính năng nằm im không ai biết là có.
ALTER TABLE "User" ADD COLUMN     "notifyHolidays" BOOLEAN NOT NULL DEFAULT true;
