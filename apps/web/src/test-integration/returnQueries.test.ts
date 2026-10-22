import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { db } from "@/server/db";
import { getReturnDetail } from "@/server/sales/returnQueries";

// Setup is similar to returnService.test.ts
const tenantId = "tenant-queries-test";

describe("returnQueries", () => {
  beforeAll(async () => {
    await db.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: "T1", slug: "t1-" + Date.now(), businessType: "RETAIL", country: "IN", contactEmail: "t1@a.com", contactPhone: "123", termsAcceptedAt: new Date() } });
    await db.tenant.upsert({ where: { id: "other-tenant" }, update: {}, create: { id: "other-tenant", name: "T2", slug: "t2-" + Date.now(), businessType: "RETAIL", country: "IN", contactEmail: "t2@a.com", contactPhone: "123", termsAcceptedAt: new Date() } });
    await db.user.upsert({ where: { id: "C" }, update: {}, create: { id: "C", tenantId, email: "c1@t.com", name: "C", passwordHash: "h", tenantRole: "STAFF" } });
    await db.user.upsert({ where: { id: "C2" }, update: {}, create: { id: "C2", tenantId: "other-tenant", email: "c2@t.com", name: "C2", passwordHash: "h", tenantRole: "STAFF" } });
    await db.user.upsert({ where: { id: "u1" }, update: {}, create: { id: "u1", tenantId, email: "u1@t.com", name: "u1", passwordHash: "h", tenantRole: "STAFF" } });
    await db.product.upsert({ where: { id: "p1" }, update: {}, create: { id: "p1", tenantId, name: "P1" } });
    await db.productVariant.upsert({ where: { id: "var_1" }, update: {}, create: { id: "var_1", tenantId, productId: "p1", sku: "SKU-Q-1", priceMinor: 100 } });
    await db.productVariant.upsert({ where: { id: "var_2" }, update: {}, create: { id: "var_2", tenantId, productId: "p1", sku: "SKU-Q-2", priceMinor: 100 } });
  });

  beforeEach(async () => {
    // Isolated tenant wipe
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: [tenantId, "other-tenant"] } } });
    await db.saleReturnPayment.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturnItem.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturn.deleteMany({ where: { tenantId: { in: [tenantId, "other-tenant"] } } });
    await db.salePayment.deleteMany({ where: { sale: { tenantId } } });
    await db.saleItem.deleteMany({ where: { tenantId: { in: [tenantId, "other-tenant"] } } });
    await db.sale.deleteMany({ where: { tenantId: { in: [tenantId, "other-tenant"] } } });
    await db.store.deleteMany({ where: { tenantId: { in: [tenantId, "other-tenant"] } } });
  });

  it("returns full snapshot and correct recorded refund amounts for a valid return", async () => {
    const store = await db.store.create({
      data: { tenantId, id: "st_Q1", name: "Query Store", code: "SQ1", addressLine: "L1", city: "C", state: "S", currency: "INR" },
    });

    const sale = await db.sale.create({
      data: {
        tenantId,
        storeId: store.id,
        id: "sale_Q1",
        idempotencyKey: "sale_Q1_idem",
        billNumber: "BL-Q1",
        cashierUserId: "u1",
        subtotalMinor: 30000,
        discountMinor: 0,
        taxMinor: 1500,
        totalMinor: 31500,
        paidMinor: 31500,
        completedAt: new Date(),
        items: {
          create: [
            {
              id: "si_1",
              variantId: "var_1",
              skuSnapshot: "SKU-Q-1",
              nameSnapshot: "Historical Product 1",
              unitPriceMinor: 10000,
              quantity: 2,
              lineTotalMinor: 20000,
              taxRateBp: 0,
              taxMinor: 0
            },
            {
              id: "si_2",
              variantId: "var_2",
              skuSnapshot: "SKU-Q-2",
              nameSnapshot: "Historical Product 2",
              unitPriceMinor: 10000,
              quantity: 1,
              lineTotalMinor: 10000,
              taxRateBp: 0,
              taxMinor: 0
            }
          ],
        },
      },
    });

    const saleReturn = await db.saleReturn.create({
      data: {
        tenantId,
        storeId: store.id,
        originalSaleId: sale.id,
        id: "ret_Q1",
        status: "COMPLETED",
        totalRefundMinor: 20000,
        idempotencyKey: "q1",
        erpSyncStatus: "SYNCED",
        erpInvoiceId: "ERP-RET-1",
        items: {
          create: [
            { originalSaleItemId: "si_1", quantity: 1, refundMinor: 10000 },
            { originalSaleItemId: "si_2", quantity: 1, refundMinor: 10000 },
          ],
        },
        payments: {
          create: [
            { method: "UPI", amountMinor: 10000, status: "CONFIRMED", reference: "REF1" },
            { method: "CASH", amountMinor: 10000, status: "CONFIRMED" },
          ],
        },
      },
    });

    const detail = await getReturnDetail({
      tenantId,
      saleId: sale.id,
      returnId: saleReturn.id,
    });

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(saleReturn.id);
    expect(detail!.status).toBe("COMPLETED");
    expect(detail!.totalRefundMinor).toBe(20000);
    expect(detail!.originalBillNumber).toBe("BL-Q1");
    expect(detail!.storeName).toBe("Query Store");
    expect(detail!.erpSyncStatus).toBe("SYNCED");
    expect(detail!.erpInvoiceId).toBe("ERP-RET-1");

    expect(detail!.items.length).toBe(2);
    const item1 = detail!.items.find((i) => i.sku === "SKU-Q-1");
    expect(item1!.name).toBe("Historical Product 1");
    expect(item1!.quantity).toBe(1);
    expect(item1!.refundMinor).toBe(10000);
    expect(item1!.soldQuantity).toBe(2);

    expect(detail!.payments.length).toBe(2);
    const upiPayment = detail!.payments.find((p) => p.method === "UPI");
    expect(upiPayment!.amountMinor).toBe(10000);
    expect(upiPayment!.reference).toBe("REF1");
  });

  it("returns null for unknown return ID", async () => {
    const detail = await getReturnDetail({
      tenantId,
      saleId: "some-sale",
      returnId: "unknown-ret",
    });
    expect(detail).toBeNull();
  });

  it("returns null for a return belonging to a different tenant", async () => {
    const store = await db.store.create({
      data: { tenantId: "other-tenant", id: "st_Q2", name: "Store", code: "SQ2", addressLine: "L1", city: "C", state: "S", currency: "INR" },
    });
    const sale = await db.sale.create({
      data: {
        tenantId: "other-tenant",
        storeId: store.id,
        id: "sale_Q2",
          idempotencyKey: "sale_Q2_idem",
          billNumber: "BL-Q2",
          cashierUserId: "C2",
        subtotalMinor: 100,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 100,
        paidMinor: 100,
      },
    });
    const ret = await db.saleReturn.create({
      data: {
        tenantId: "other-tenant",
        storeId: store.id,
        originalSaleId: sale.id,
        id: "ret_Q2",
        totalRefundMinor: 100,
        idempotencyKey: "q2",
      },
    });

    const detail = await getReturnDetail({
      tenantId, // attempting to read other tenant's return
      saleId: sale.id,
      returnId: ret.id,
    });
    expect(detail).toBeNull();
    
    await db.saleReturnPayment.deleteMany({ where: { saleReturn: { tenantId: 'other-tenant' } } });
    await db.saleReturnItem.deleteMany({ where: { saleReturn: { tenantId: 'other-tenant' } } });
    await db.saleReturn.deleteMany({ where: { tenantId: 'other-tenant' } });
    await db.salePayment.deleteMany({ where: { sale: { tenantId: 'other-tenant' } } });
    await db.saleItem.deleteMany({ where: { tenantId: 'other-tenant' } });
    await db.sale.deleteMany({ where: { tenantId: 'other-tenant' } });
    await db.store.deleteMany({ where: { tenantId: 'other-tenant' } });
  });

  it("returns null for a return belonging to a different sale", async () => {
    const store = await db.store.create({
      data: { tenantId, id: "st_Q3", name: "Query Store", code: "SQ3", addressLine: "L1", city: "C", state: "S", currency: "INR" },
    });
    const sale1 = await db.sale.create({
      data: {
        tenantId, storeId: store.id, id: "sale_Q3_1", idempotencyKey: "sale_Q3_1_idem", billNumber: "BL-3-1", cashierUserId: "C",
        subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100, paidMinor: 100,
      },
    });
    const sale2 = await db.sale.create({
      data: {
        tenantId, storeId: store.id, id: "sale_Q3_2", idempotencyKey: "sale_Q3_2_idem", billNumber: "BL-3-2", cashierUserId: "C",
        subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100, paidMinor: 100,
      },
    });
    const ret = await db.saleReturn.create({
      data: {
        tenantId,
        storeId: store.id,
        originalSaleId: sale1.id,
        id: "ret_Q3",
        totalRefundMinor: 100,
        idempotencyKey: "q3",
      },
    });

    const detail = await getReturnDetail({
      tenantId,
      saleId: sale2.id, // Trying to access return through wrong sale
      returnId: ret.id,
    });
    expect(detail).toBeNull();
  });
});
