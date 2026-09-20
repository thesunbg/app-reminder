-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWebPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quietFrom" TEXT,
ADD COLUMN     "quietTo" TEXT,
ADD COLUMN     "telegramLinkCode" TEXT,
ADD COLUMN     "telegramLinkExpires" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkCode_key" ON "User"("telegramLinkCode");

