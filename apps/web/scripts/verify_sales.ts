import { db } from "../src/server/db";
import { createSale } from "../src/server/sales/saleService";
import { randomUUID } from "crypto";
import { dispatchOutboxOnce } from "../src/server/events/outboxDispatcher";

async function run() {
  const tenantId = "t-aaaaaaaaaaaaaaaaaaaaaaaa";
  const storeId = "s-aaaaaaaaaaaaaaaaaaaaaaaa";
  const userId = "u-aaaaaaaaaaaaaaaaaaaaaaaa";
  const variantId = "V-1791294259071";

  const url = process.env.ERP_SITE_FRONTEND_URL || "http://localhost:8080";
  const key = process.env.ERP_SITE_FRONTEND_KEY || (() => { throw new Error("Missing ERP_SITE_FRONTEND_KEY environment variable"); })();
  const secret = process.env.ERP_SITE_FRONTEND_SECRET || (() => { throw new Error("Missing ERP_SITE_FRONTEND_SECRET environment variable"); })();

  const createAndSync = async (methods: any[], name: string) => {
    const saleId = randomUUID(); // IDEMPOTENCY check setup
    console.log(`\n=== Creating LIVE Sale: ${name} ===`);
    const saleRes = await createSale({
      tenantId, storeId, cashierUserId: userId,
      correlationId: saleId,
      idempotencyKey: saleId,
      lines: [{ variantId, quantity: 200 }], // 200 items * 1 INR = 200 INR total
      payments: methods
    });
    
    if (saleRes.status !== "ok") throw new Error("Sale failed: " + JSON.stringify(saleRes));
    console.log("Dispatching outbox...");
    const outboxRes = await dispatchOutboxOnce({ tenantId });
    console.log("Dispatch result:", outboxRes);

    const sale = await db.sale.findUnique({ where: { id_tenantId: { tenantId, id: saleRes.sale.id } } });
    console.log(`${name} sync status:`, sale?.erpSyncStatus);
    
    if (sale?.erpSyncStatus === "SYNCED" && sale.erpInvoiceId) {
      const invId = sale.erpInvoiceId;
      console.log(`${name} ERP Invoice ID:`, invId);
      
      const res = await fetch(url + `/api/resource/Sales Invoice/${invId}`, {
        headers: { "Authorization": `token ${key}:${secret}` }
      });
      const erpRes = await res.json();
      console.log(`ERP DocStatus:`, erpRes.data.docstatus);
      console.log(`ERP Payments:`);
      for (const p of erpRes.data.payments || []) {
        console.log(`  - ${p.mode_of_payment}: ${p.amount}`);
      }
    } else {
      console.log("Check outbox for errors in DB.");
    }
  };

  await createAndSync([{ method: "CASH", amountMinor: 20000 }], "CashSale");
  await createAndSync([{ method: "UPI", amountMinor: 20000 }], "UpiSale");
  await createAndSync([{ method: "CARD", amountMinor: 20000 }], "CardSale");
  await createAndSync([
    { method: "CASH", amountMinor: 5000 },
    { method: "UPI", amountMinor: 7000 },
    { method: "CARD", amountMinor: 8000 }
  ], "SplitSale");

}
run().catch(console.error).finally(() => process.exit(0));
