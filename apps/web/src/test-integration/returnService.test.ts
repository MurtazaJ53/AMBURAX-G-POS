import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../server/db";
import { createReturn, CreateReturnInput } from "../server/sales/returnService";
import { PaymentMethod, SaleStatus, StockMovementType, ErpSyncStatus } from "@prisma/client";
import { randomUUID } from "crypto";

describe("Returns & Exchanges Domain Foundation", () => {
  const tenantId = "tenant-return-1";
  const storeId = "store-return-1";
  const otherStoreId = "store-return-2";
  const cashierId = "cashier-1";

  let testSaleId = "";
  let testItemId = "";
  let testVariantId = "";

  beforeEach(async () => {
    // Teardown first in case of dirty state
    await db.saleReturnPayment.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturnItem.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturn.deleteMany({ where: { tenantId } });
    await db.stockMovement.deleteMany({ where: { tenantId } });
    await db.salePayment.deleteMany({ where: { sale: { tenantId } } });
    await db.saleItem.deleteMany({ where: { tenantId } });
    await db.sale.deleteMany({ where: { tenantId } });
    await db.productVariant.deleteMany({ where: { tenantId } });
    await db.product.deleteMany({ where: { tenantId } });
    await db.store.deleteMany({ where: { tenantId } });
    await db.user.deleteMany({ where: { tenantId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });

    // Setup base tenant/store/product
    await db.tenant.create({ data: { id: tenantId, name: "Return Tenant", slug: "return-tenant", businessType: "RETAIL", country: "IN", contactEmail: "a@a.com", contactPhone: "123", termsAcceptedAt: new Date() } });
    await db.user.create({ data: { id: cashierId, tenantId, email: "cashier@test.com", passwordHash: "x", name: "Cashier", tenantRole: "STAFF" } });
    await db.store.create({ data: { id: storeId, tenantId, name: "Return Store", currency: "INR", code: "S1", addressLine: "A1", city: "C", state: "S" } });
    await db.store.create({ data: { id: otherStoreId, tenantId, name: "Other Store", currency: "INR", code: "S2", addressLine: "A2", city: "C", state: "S" } });
    
    const product = await db.product.create({
      data: { tenantId, name: "Test Product" }
    });
    const variant = await db.productVariant.create({
      data: { tenantId, productId: product.id, sku: "RET-1", priceMinor: 500 }
    });
    testVariantId = variant.id;

    // Create a base SALE to return against
    // 2 items @ 500 = 1000 total
    const sale: any = await db.sale.create({
      data: {
        tenantId,
        storeId,
        cashierUserId: cashierId,
        billNumber: "RET-001",
        status: SaleStatus.COMPLETED,
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1000,
        paidMinor: 1000, // Fully paid
        idempotencyKey: randomUUID(),
        erpSyncStatus: ErpSyncStatus.PENDING,
        items: {
          create: [{
            variantId: variant.id,
            skuSnapshot: "RET-1",
            nameSnapshot: "RET-1",
            quantity: 2,
            unitPriceMinor: 500,
            taxRateBp: 0,
            taxMinor: 0,
            lineTotalMinor: 1000,
          }]
        },
        payments: {
          create: [{
            method: PaymentMethod.CASH,
            amountMinor: 1000,
          }]
        }
      },
      include: { items: true }
    });

    testSaleId = sale.id;
    testItemId = sale.items[0].id;

    // Initial stock
    await db.stockMovement.create({
      data: {
        tenantId, storeId, variantId: variant.id, type: StockMovementType.OPENING_BALANCE,
        quantityDelta: 10, balanceAfter: 10, idempotencyKey: randomUUID()
      }
    });
    // Sale stock movement
    await db.stockMovement.create({
      data: {
        tenantId, storeId, variantId: variant.id, type: StockMovementType.SALE,
        quantityDelta: -2, balanceAfter: 8, idempotencyKey: randomUUID()
      }
    });
  });

  afterEach(async () => {
    await db.saleReturnPayment.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturnItem.deleteMany({ where: { saleReturn: { tenantId } } });
    await db.saleReturn.deleteMany({ where: { tenantId } });
    await db.stockMovement.deleteMany({ where: { tenantId } });
    await db.salePayment.deleteMany({ where: { sale: { tenantId } } });
    await db.saleItem.deleteMany({ where: { tenantId } });
    await db.sale.deleteMany({ where: { tenantId } });
    await db.productVariant.deleteMany({ where: { tenantId } });
    await db.product.deleteMany({ where: { tenantId } });
    await db.store.deleteMany({ where: { tenantId } });
    await db.user.deleteMany({ where: { tenantId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("1, 3. full return & historical price preservation", async () => {
    const res: any = await createReturn({
      tenantId,
      storeId,
      originalSaleId: testSaleId,
      idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 2 }],
      refundPayments: [{ method: "CASH", amountMinor: 1000 }]
    });

    expect(res.duplicate).toBe(false);
    expect(res.saleReturn.totalRefundMinor).toBe(1000);
    expect(res.saleReturn.items[0].quantity).toBe(2);
    expect(res.saleReturn.items[0].refundMinor).toBe(1000);

    // Verify stock
    const lastStock = await db.stockMovement.findFirst({
      where: { tenantId, storeId, variantId: testVariantId },
      orderBy: { createdAt: "desc" }
    });
    expect(lastStock!.type).toBe(StockMovementType.RETURN);
    expect(lastStock!.quantityDelta).toBe(2);
    expect(lastStock!.balanceAfter).toBe(10); // 8 + 2
  });

  it("2, 3. partial quantity return", async () => {
    const res: any = await createReturn({
      tenantId,
      storeId,
      originalSaleId: testSaleId,
      idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 500 }]
    });

    expect(res.duplicate).toBe(false);
    expect(res.saleReturn.totalRefundMinor).toBe(500); // 500 prorated from 1000 for 1/2 qty
    expect(res.saleReturn.items[0].refundMinor).toBe(500);
  });

  it("4. over-return rejection", async () => {
    await expect(createReturn({
      tenantId, storeId, originalSaleId: testSaleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 3 }],
      refundPayments: [{ method: "CASH", amountMinor: 1500 }]
    })).rejects.toThrow("Return quantity exceeds originally sold quantity");
  });

  it("5. duplicate idempotency request", async () => {
    const idempKey = randomUUID();
    const req: CreateReturnInput = {
      tenantId, storeId, originalSaleId: testSaleId, idempotencyKey: idempKey,
      items: [{ originalSaleItemId: testItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 500 }]
    };

    const first = await createReturn(req);
    expect(first.duplicate).toBe(false);

    const second = await createReturn(req);
    expect(second.duplicate).toBe(true);
    expect(second.saleReturn.id).toBe(first.saleReturn.id);
  });

  it("6. concurrent return race", async () => {
    // Attempt to return 2 items twice concurrently (sold 2 total)
    const req1 = createReturn({
      tenantId, storeId, originalSaleId: testSaleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 2 }],
      refundPayments: [{ method: "CASH", amountMinor: 1000 }]
    });
    
    const req2 = createReturn({
      tenantId, storeId, originalSaleId: testSaleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 2 }],
      refundPayments: [{ method: "CASH", amountMinor: 1000 }]
    });

    const results = await Promise.allSettled([req1, req2]);
    const successes = results.filter(r => r.status === "fulfilled");
    const errors = results.filter(r => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(errors.length).toBe(1);
    const msg = (errors[0] as any).reason.message;
    expect(msg.includes("exceeds") || msg.includes("conflict") || msg.includes("deadlock")).toBe(true);
  });

  it("7, 8. cross-store / cross-warehouse rejection", async () => {
    await expect(createReturn({
      tenantId, storeId: otherStoreId, originalSaleId: testSaleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 500 }]
    })).rejects.toThrow("Cross-store returns are not permitted");
  });

  it("10. tenant isolation", async () => {
    await expect(createReturn({
      tenantId: "some-other-tenant", storeId, originalSaleId: testSaleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: testItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 500 }]
    })).rejects.toThrow("Tenant isolation violation");
  });

  it("unpaid Khata return prevents cash refund", async () => {
    // Create a sale that is unpaid
    const udharSale: any = await db.sale.create({
      data: {
        tenantId, storeId, cashierUserId: cashierId, billNumber: "RET-002",
        status: SaleStatus.COMPLETED,
        subtotalMinor: 1000, discountMinor: 0, taxMinor: 0, totalMinor: 1000,
        paidMinor: 0, // NO CASH PAID
        idempotencyKey: randomUUID(), erpSyncStatus: ErpSyncStatus.PENDING,
        items: {
          create: [{
            variantId: testVariantId, skuSnapshot: "RET-1", nameSnapshot: "RET-1",
            quantity: 1, unitPriceMinor: 1000, taxRateBp: 0, taxMinor: 0, lineTotalMinor: 1000,
          }]
        }
      },
      include: { items: true }
    });

    await expect(createReturn({
      tenantId, storeId, originalSaleId: udharSale.id, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: udharSale.items[0].id, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 1000 }] // Try to refund cash
    })).rejects.toThrow("Refund exceeds collected cash");
  });
});
