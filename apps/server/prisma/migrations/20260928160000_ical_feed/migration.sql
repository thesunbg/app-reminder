-- Link đăng ký lịch (.ics). Chỉ lưu SHA-256 của token, giống Session và
-- AgentDevice: link là một bí mật đọc được lịch cả nhà, lộ file dump là lộ lịch.
ALTER TABLE "User" ADD COLUMN     "icalTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN     "icalCreatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "icalLastUsedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_icalTokenHash_key" ON "User"("icalTokenHash");
