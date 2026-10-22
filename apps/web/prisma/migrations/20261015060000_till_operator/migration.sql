-- Shared counter PIN switch: who is selling on a signed-in till (owner decision 2026-10-15).

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "tillOperatorUserId" TEXT,
ADD COLUMN     "tillOperatorUntil" TIMESTAMP(3);
