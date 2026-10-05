import { db } from "./src/server/db";
import { createProduct, createVariant } from "./src/server/catalog/catalogService";
import { createSale } from "./src/server/sales/saleService";
import { randomUUID } from "crypto";
import { dispatchOutboxOnce } from "./src/server/events/outboxDispatcher";
import { resolveOutboxPublisher } from "./src/server/events/publisher";

async function run() {
  await db.outboxEvent.deleteMany(); // Clear old ones

  const tenant = await db.tenant.findFirst({
    where: { erpnextSiteId: "frontend", erpnextProvisionStatus: "PROVISIONED" }
  });

  if (!tenant) throw new Error("No provisioned tenant found!");
  const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
  if (!user) throw new Error("No user found!");

  const actor = {
    tenantId: tenant.id,
    userId: user.id,
    tenantRole: "OWNER" as const,
  };

  const correlationId = randomUUID();

  // 1. Create Product
  const pRes = await createProduct({
    actor,
    correlationId,
    name: "E2E POS Sync Product",
    category: "Products",
    brand: null,
    baseUomId: null,
    isActive: true,
  });

  if (pRes.status !== "ok") throw new Error("Failed to create product");

  // 2. Create Variant
  const sku = "E2E-" + Math.random().toString(36).substring(2, 6).toUpperCase();
  const vRes = await createVariant({
    actor,
    correlationId,
    productId: pRes.productId,
    sku,
    barcode: null,
    size: "M",
    colour: "Green",
    priceMinor: 2500,
    mrpMinor: 3000,
    isActive: true,
  });

  if (vRes.status !== "ok") throw new Error("Failed to create variant");

  console.log(`[1] Created variant ${vRes.variantId} in AMBURAX.`);

  // 3. Create Sale using this new Variant
  const store = await db.store.findFirst({ where: { tenantId: tenant.id } });
  if (store) {
    await db.store.update({
      where: { id: store.id },
      data: { erpnextWarehouseId: "Stores - AR" }
    });
  }

  const sRes = await createSale({
    tenantId: tenant.id,
    storeId: store?.id ?? "UNKNOWN",
    cashierUserId: user.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    lines: [{
      variantId: vRes.variantId,
      quantity: 2,
      unitPriceMinor: 2500,
      taxRateBp: 0,
      discountMinor: 0,
    }],
    payments: [{
      method: "CASH",
      amountMinor: 5000,
    }],
  });

  if (sRes.status !== "ok") throw new Error(`Failed to create sale: ${JSON.stringify(sRes)}`);

  console.log(`[2] Created AMBURAX Sale ${sRes.sale.id}. Dispatching outbox...`);
  
  const publisher = resolveOutboxPublisher();
  
  const dispatched = await dispatchOutboxOnce({
    batchSize: 10,
    publisher,
  });

  console.log(`[3] Dispatched ${dispatched.dispatchedCount ?? dispatched.processedCount ?? "?"} events.`);

  const v = await db.productVariant.findUnique({ where: { id: vRes.variantId } });
  console.log("ERP Sync Status:", v?.erpSyncStatus);

  const outboxEvents = await db.outboxEvent.findMany({ 
    where: { tenantId: tenant.id },
    orderBy: { occurredAt: "asc" }
  });

  console.log(`\n--- OUTBOX VERIFICATION ---`);
  for (const e of outboxEvents) {
    console.log(`Event: ${e.eventType} | Entity: ${e.entityId} | Published: ${e.publishedAt ? "YES" : "NO"} | Last Error: ${e.lastError || "None"}`);
  }

  if (v?.erpSyncStatus === "SYNCED") {
    console.log("\n✅ SUCCESS: The variant was synced to ERPNext.");
  } else {
    console.error("\n❌ FAILED: The variant did not sync.");
  }

  const saleEvent = outboxEvents.find(e => e.eventType === "SaleCompleted");
  if (saleEvent && saleEvent.publishedAt && !saleEvent.lastError) {
    console.log("✅ SUCCESS: The sale was successfully synced to ERPNext.");
  } else {
    console.error("❌ FAILED: The sale did not sync successfully.");
  }

}

run().catch(console.error);
