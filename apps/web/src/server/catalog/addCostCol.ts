import { db } from "@/server/db";

async function addCostCol() {
  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE "product_variants" 
      ADD COLUMN IF NOT EXISTS "costPriceMinor" INTEGER;
    `);
    console.log("costPriceMinor column added to product_variants successfully.");
  } catch (err) {
    console.error("Failed to add costPriceMinor:", err);
  }
}

addCostCol().catch(console.error);
