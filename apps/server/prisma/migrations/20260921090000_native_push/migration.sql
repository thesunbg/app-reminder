-- Phase 7: push native qua FCM cho app Capacitor

ALTER TABLE "User" ADD COLUMN "notifyNative" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "NativeDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NativeDevice_token_key" ON "NativeDevice"("token");
CREATE INDEX "NativeDevice_userId_idx" ON "NativeDevice"("userId");

ALTER TABLE "NativeDevice" ADD CONSTRAINT "NativeDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
