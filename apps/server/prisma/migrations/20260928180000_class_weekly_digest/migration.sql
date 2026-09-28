-- Nhắc thời khoá biểu hôm sau + tổng kết tuần.
ALTER TYPE "NotificationKind" ADD VALUE 'WEEKLY_DIGEST';
ALTER TYPE "NotificationKind" ADD VALUE 'CLASS_TOMORROW';

-- Bật sẵn 20:00: chỉ bắn khi hôm sau thật sự có tiết, mà người lớn không có
-- thời khoá biểu nên bật sẵn cũng không phiền ai. Tắt sẵn thì con không biết là có.
ALTER TABLE "User" ADD COLUMN     "classReminderAt" TEXT DEFAULT '20:00';
-- Tổng kết tuần thì ngược lại: mặc định tắt, ai muốn thì bật ở Cài đặt.
ALTER TABLE "User" ADD COLUMN     "weeklyDigestAt" TEXT;
