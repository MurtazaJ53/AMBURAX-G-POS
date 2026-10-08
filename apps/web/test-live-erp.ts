import { db } from "./src/server/db";
import { createSale } from "./src/server/sales/saleService";
import { createReturn } from "./src/server/sales/returnService";
import { dispatchOutboxOnce } from "./src/server/events/outboxDispatcher";
import { ErpOutboxPublisher } from "./src/server/erp/outboxPublisher";
import { randomUUID } from "crypto";

async function runLiveTest() {
  const tenantId = "t-100"; // Assuming a default tenant exists
  const storeId = "st-100";
  const userId = "u-100";
  
  // Find a tenant
  const tenant = await db.tenant.findFirst();
  if (!tenant) throw new Error("No tenant");
  
  const store = await db.store.findFirst({ where: { tenantId: tenant.id } });
  if (!store) throw new Error("No store");
  
  const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
  
  const product = await db.product.findFirst({ where: { tenantId: tenant.id } });
  const variant = await db.productVariant.findFirst({ where: { productId: product?.id } });
  
  if (!variant) throw new Error("No variant");

  console.log("Creating sale...");
  const saleRes = await createSale({
    tenantId: tenant.id,
    storeId: store.id,
    cashierUserId: user?.id || "u-100",
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    lines: [{ variantId: variant.id, quantity: 2 }],
    payment: { method: "CASH", amountMinor: variant.priceMinor * 2 },
  });
  
  if (saleRes.status !== "ok" || !saleRes.sale) throw new Error("Sale creation failed");
  const saleId = saleRes.sale.id;
  if (!saleId) throw new Error("Sale creation failed");
  
  console.log("Dispatching sale to ERP...");
  await dispatchOutboxOnce({ tenantId: tenant.id, publisher: new ErpOutboxPublisher() });
  
  const sale = await db.sale.findUnique({ where: { id: saleId }, include: { items: true } });
  console.log("ERP Invoice:", sale?.erpInvoiceId);
  
  console.log("Creating return...");
  if (!sale) throw new Error("no sale in DB");
  const retRes = await createReturn({
    tenantId: tenant.id,
    storeId: store.id,
    originalSaleId: saleId,
    idempotencyKey: randomUUID(),
    items: [{ originalSaleItemId: sale.items[0]!.id, quantity: 1 }],
    refundPayments: [{ method: "CASH", amountMinor: variant.priceMinor }],
  });
  
  const retId = retRes.saleReturn.id;
  console.log("Dispatching return to ERP...");
  await dispatchOutboxOnce({ tenantId: tenant.id, publisher: new ErpOutboxPublisher() });
  
  const ret = await db.saleReturn.findUnique({ where: { id: retId } });
  console.log("ERP Return Invoice:", ret?.erpInvoiceId);
}

runLiveTest().then(() => console.log("Done")).catch(console.error);
