import { db } from "./src/server/db";
import { createSale } from "./src/server/sales/saleService";
import { randomUUID } from "crypto";
import { dispatchOutboxOnce } from "./src/server/events/outboxDispatcher";
import { getSaleDetail } from "./src/server/sales/saleQueries";

async function run() {
  await db.outboxEvent.deleteMany(); // Clear old ones

  const tenant = await db.tenant.findFirst({
    where: { erpnextSiteId: "frontend", erpnextProvisionStatus: "PROVISIONED" }
  });

  if (!tenant) {
    console.error("No provisioned tenant found!");
    process.exit(1);
  }

  const store = await db.store.findFirst({ where: { tenantId: tenant.id } });
  
  if (store) {
    await db.store.update({
      where: { id: store.id },
      data: { erpnextWarehouseId: "Stores - AR" }
    });
  }

  const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
  
  // Ensure DEMO-ITEM exists
  let variant = await db.productVariant.findUnique({ where: { id: "DEMO-ITEM" } });
  if (!variant) {
    const product = await db.product.findFirst({ where: { tenantId: tenant.id } });
    if (!product) throw new Error("No product");
    variant = await db.productVariant.create({
      data: {
        id: "DEMO-ITEM",
        tenantId: tenant.id,
        productId: product.id,
        sku: "DEMO-ITEM",
        priceMinor: 1000
      }
    });
  }

  const session = await db.posSession.findFirst({ where: { tenantId: tenant.id, closedAt: null } });

  if (!store || !user || !variant) {
    console.error("Missing store, user, or variant");
    process.exit(1);
  }

  console.log("Creating sale...");
  const saleResult = await createSale({
    tenantId: tenant.id,
    storeId: store.id,
    cashierUserId: user.id,
    posSessionId: session?.id,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    lines: [
      { variantId: variant.id, quantity: 1 }
    ],
    payment: { method: "CASH", amountMinor: variant.priceMinor }
  });

  if (saleResult.status !== "ok") {
    console.error("Sale failed:", saleResult);
    process.exit(1);
  }

  const saleId = saleResult.sale.id;
  console.log("Sale created:", saleId);

  console.log("Dispatching outbox...");
  const result = await dispatchOutboxOnce();
  console.log("Outbox dispatch result:", result);

  const outboxRecords = await db.outboxEvent.findMany();
  for (const ev of outboxRecords) {
    console.log("Outbox Error:", ev.lastError);
  }

  const sale = await getSaleDetail({ tenantId: tenant.id, saleId });
  console.log("Sale ERP Status:", sale?.erpSyncStatus);
  console.log("ERP Reference:", sale?.erpInvoiceId);
}

run().catch(console.error).finally(() => process.exit(0));
