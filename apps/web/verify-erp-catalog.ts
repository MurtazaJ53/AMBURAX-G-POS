import { db } from "./src/server/db";
import { createProduct, createVariant, updateVariant } from "./src/server/catalog/catalogService";
import { randomUUID } from "crypto";
import { dispatchOutboxOnce } from "./src/server/events/outboxDispatcher";
import { resolveOutboxPublisher } from "./src/server/events/publisher";

async function run() {
  await db.outboxEvent.deleteMany(); // Clear old ones

  const tenant = await db.tenant.findFirst({
    where: { erpnextSiteId: "frontend", erpnextProvisionStatus: "PROVISIONED" }
  });

  if (!tenant) {
    console.error("No provisioned tenant found!");
    process.exit(1);
  }

  const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
  
  if (!user) {
    console.error("No user found!");
    process.exit(1);
  }

  const actor = {
    tenantId: tenant.id,
    userId: user.id,
    tenantRole: "OWNER" as const,
  };

  const correlationId = randomUUID();

  // Create a real product
  const pRes = await createProduct({
    actor,
    correlationId,
    name: "Real Sync Product",
    category: "Products",
    brand: null,
    baseUomId: null,
    isActive: true,
  });

  if (pRes.status !== "ok") {
    console.error("Failed to create product", pRes);
    process.exit(1);
  }

  // Create a real variant
  const sku = "SYNC-" + Math.random().toString(36).substring(2, 6).toUpperCase();
  const vRes = await createVariant({
    actor,
    correlationId,
    productId: pRes.productId,
    sku,
    barcode: null,
    size: "L",
    colour: "Red",
    priceMinor: 1000,
    mrpMinor: 1200,
    isActive: true,
  });

  if (vRes.status !== "ok") {
    console.error("Failed to create variant", vRes);
    process.exit(1);
  }

  console.log(`Created variant ${vRes.variantId} in AMBURAX. Dispatching outbox...`);
  
  const publisher = resolveOutboxPublisher();
  
  const dispatched = await dispatchOutboxOnce({
    batchSize: 10,
    publisher,
  });

  console.log(`Dispatched ${dispatched.dispatchedCount ?? dispatched.processedCount ?? "?"} events.`);

  const v = await db.productVariant.findUnique({ where: { id: vRes.variantId } });
  console.log("ERP Sync Status:", v?.erpSyncStatus);

  if (v?.erpSyncStatus === "SYNCED") {
    console.log("SUCCESS! The variant was synced to ERPNext.");

    // Now let's try updating it
    console.log("Testing update...");
    await updateVariant({
      actor,
      correlationId: randomUUID(),
      variantId: vRes.variantId,
      priceMinor: 1500, // Change price
      isActive: true,
    });

    const dispatchedUpdate = await dispatchOutboxOnce({
      batchSize: 10,
      publisher,
    });

    console.log(`Dispatched ${dispatchedUpdate.dispatchedCount ?? dispatchedUpdate.processedCount ?? "?"} events for update.`);
    const vUpdated = await db.productVariant.findUnique({ where: { id: vRes.variantId } });
    console.log("ERP Sync Status after update:", vUpdated?.erpSyncStatus);

  } else {
    console.error("FAILED! It did not sync.");
  }
}

run().catch(console.error);
