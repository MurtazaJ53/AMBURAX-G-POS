-- Step 5b: Add isFreeSample column to stock_movements
ALTER TABLE "stock_movements" 
  ADD COLUMN IF NOT EXISTS "isFreeSample" BOOLEAN NOT NULL DEFAULT false;
