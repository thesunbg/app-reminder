-- Sổ sức khoẻ: chiều cao/cân nặng theo tháng, mũi tiêm, lịch khám, đơn thuốc.
CREATE TYPE "HealthKind" AS ENUM ('GROWTH', 'VACCINE', 'CHECKUP', 'MEDICINE');

CREATE TABLE "HealthRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "HealthKind" NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "note" TEXT,
    "nextDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthRecord_userId_kind_date_idx" ON "HealthRecord"("userId", "kind", "date");
CREATE INDEX "HealthRecord_nextDate_idx" ON "HealthRecord"("nextDate");

ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
