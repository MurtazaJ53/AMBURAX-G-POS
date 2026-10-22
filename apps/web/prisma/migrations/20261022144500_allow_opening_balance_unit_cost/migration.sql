-- Step 5: Allow OPENING_BALANCE, ADJUSTMENT, and STOCK_TAKE to carry unitCostMinor
-- Preserves existing rows with unitCostMinor IS NULL (all 49 existing opening balance rows remain 100% valid)

ALTER TABLE "stock_movements" 
  DROP CONSTRAINT IF EXISTS "stock_movements_unit_cost_check";

ALTER TABLE "stock_movements" 
  ADD CONSTRAINT "stock_movements_unit_cost_check" 
  CHECK (
    ("unitCostMinor" IS NULL) OR (
      ("unitCostMinor" >= 0) AND (
        type = ANY (ARRAY[
          'RECEIPT'::"StockMovementType", 
          'TRANSFER_IN'::"StockMovementType", 
          'OPENING_BALANCE'::"StockMovementType",
          'ADJUSTMENT'::"StockMovementType",
          'STOCK_TAKE'::"StockMovementType"
        ])
      )
    )
  );
