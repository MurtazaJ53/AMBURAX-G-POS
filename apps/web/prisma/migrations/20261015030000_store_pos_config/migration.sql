-- Screen 74: per-store POS configuration. Held bills expire after heldBillHours (decision 36 caps at 24).

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "heldBillHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "stores" ADD CONSTRAINT "stores_held_bill_hours" CHECK ("heldBillHours" BETWEEN 1 AND 24);
ALTER TABLE "stores" ADD CONSTRAINT "stores_late_grace" CHECK ("lateGraceMinutes" BETWEEN 0 AND 120);
ALTER TABLE "stores" ADD CONSTRAINT "stores_half_day_percent" CHECK ("halfDayPercent" BETWEEN 10 AND 90);
