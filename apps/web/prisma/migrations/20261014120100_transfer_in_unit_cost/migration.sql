-- A received transfer brings its cost with it: allow a unit cost on TRANSFER_IN as well as
-- RECEIPT. Separate from the migration that adds the enum value, because PostgreSQL refuses to
-- use a new enum value in the same transaction that created it.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_unit_cost_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_cost_check"
  CHECK ("unitCostMinor" IS NULL OR ("unitCostMinor" >= 0 AND "type" IN ('RECEIPT', 'TRANSFER_IN')));
