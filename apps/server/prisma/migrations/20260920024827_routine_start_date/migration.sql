/*
  Warnings:

  - Added the required column `startDate` to the `Routine` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Routine" ADD COLUMN     "startDate" TEXT NOT NULL;
