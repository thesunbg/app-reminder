-- Phase 8: agent máy tính báo cáo thời lượng dùng app

CREATE TABLE "AgentDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastReportAt" TIMESTAMP(3),

    CONSTRAINT "AgentDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentDevice_tokenHash_key" ON "AgentDevice"("tokenHash");
CREATE INDEX "AgentDevice_userId_idx" ON "AgentDevice"("userId");

CREATE TABLE "ScreenReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreenReport_deviceId_date_app_key" ON "ScreenReport"("deviceId", "date", "app");
CREATE INDEX "ScreenReport_userId_date_idx" ON "ScreenReport"("userId", "date");

ALTER TABLE "AgentDevice" ADD CONSTRAINT "AgentDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreenReport" ADD CONSTRAINT "ScreenReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreenReport" ADD CONSTRAINT "ScreenReport_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "AgentDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
