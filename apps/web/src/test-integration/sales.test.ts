import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";
import { listSales, getSaleDetail } from "@/server/sales/saleQueries";
import { searchCatalog } from "@/server/sales/catalog";
import { searchCustomers, createCustomer } from "@/server/sales/customers";

/**
 * The sale path against a real PostgreSQL database.
 *
 * These are the assertions that cannot be made with a mocked client, because what is being
 * tested *is* the database's behaviour: unique constraints, transactional rollback, row
 * locks and cross-tenant scoping. A mock would assert that the code calls Prisma in a
 * particular order, which is not the same thing as the guarantee.
 */

let counter = 0;
/** Unique per call, so a test that means to create a new sale is never accidentally a retry. */
function freshKey(prefix = "key"): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

function saleInput(overrides: Partial<Parameters<typeof createSale>[0]> = {}) {
  return {
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: freshKey(),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
    payment: { method: "CASH" as const },
    correlationId: "corr-test",
    ...overrides,
  };
}

/**
 * Force the sale transaction to fail at its last moment.
 *
 * A trigger on `sale_items` is the most honest available failure: it aborts *after* the
 * bill number was allocated and the sale row inserted, which is exactly the window where a
 * partial write would do damage. Failing earlier would prove much less.
 */
async function withFailingSaleItemInsert(body: () => Promise<void>): Promise<void> {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION fail_sale_insert() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'forced failure for test'; END; $$ LANGUAGE plpgsql;`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_sale_items BEFORE INSERT ON sale_items
     FOR EACH ROW EXECUTE FUNCTION fail_sale_insert();`,
  );
  try {
    await body();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_sale_items ON sale_items;`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_sale_insert();`);
  }
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();

  describe("Split Payments", () => {
    it("Exactly matches total", async () => {
      // Create a sale to find total
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `trial-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-1",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `split-exact-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payments: [
          { method: "CASH", amountMinor: total / 2 },
          { method: "UPI", amountMinor: total / 2, reference: "txn_123" }
        ],
        correlationId: "corr-1",
      });
      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.sale.totalMinor).toBe(total);
        expect(res.sale.paidMinor).toBe(total);
      }
    });

    it("Insufficient sum fails", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `trial2-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-2",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `split-insuf-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payments: [
          { method: "CASH", amountMinor: total / 2 - 100 },
          { method: "UPI", amountMinor: total / 2 }
        ],
        correlationId: "corr-2",
      });
      expect(res.status).toBe("validation_error");
    });

    it("Overpayment requires CASH", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `trial3-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-3",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `split-over-upi-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payments: [
          { method: "UPI", amountMinor: total + 100 }
        ],
        correlationId: "corr-3",
      });
      expect(res.status).toBe("validation_error");
    });

    it("Overpayment works with CASH", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `trial4-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-4",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: `split-over-cash-${Date.now()}`,
        lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
        payments: [
          { method: "UPI", amountMinor: total - 100 },
          { method: "CASH", amountMinor: 200 }
        ],
        correlationId: "corr-4",
      });
      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.sale.totalMinor).toBe(total);
        expect(res.sale.paidMinor).toBe(total);
      }
    });
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createSale — the happy path", () => {
  it("records the sale, its items, its payment and its stock movement in one transaction", async () => {
    const result = await createSale(saleInput());

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.duplicate).toBe(false);
    // 2 x ₹1000.00 at 5% inclusive: total ₹2000.00, tax contained within it.
    expect(result.sale.totalMinor).toBe(200_000);
    expect(result.sale.subtotalMinor + result.sale.taxMinor).toBe(result.sale.totalMinor);
    expect(result.sale.paidMinor).toBe(result.sale.totalMinor);

    const stored = await db.sale.findUnique({
      where: { id: result.sale.id },
      include: { items: true, payments: true },
    });
    expect(stored?.items).toHaveLength(1);
    expect(stored?.payments).toHaveLength(1);
    expect(stored?.payments[0]?.amountMinor).toBe(200_000);

    // Opening stock 10, sold 2.
    const stock = await db.stockLevel.findUnique({
      where: {
        storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 },
      },
    });
    expect(stock?.quantity).toBe(8);
  });

  it("prices the sale from the database, ignoring anything the caller might believe", async () => {
    // The input carries no prices at all — that is the point. The recorded amount must
    // match the variant row, so a tampered client has nothing to tamper with.
    const result = await createSale(
      saleInput({ lines: [{ variantId: COMMERCE_IDS.variantA2, quantity: 1 }] }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.sale.totalMinor).toBe(200_000); // variantA2 is ₹2000.00
  });

  it("stores line snapshots so a later price change cannot rewrite the bill", async () => {
    const result = await createSale(saleInput());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    await db.productVariant.update({
      where: { id: COMMERCE_IDS.variantA1 },
      data: { priceMinor: 999_999, sku: "RENAMED" },
    });

    const detail = await getSaleDetail({ tenantId: IDS.tenantA, saleId: result.sale.id });
    expect(detail?.items[0]?.sku).toBe("A-SHIRT-M");
    expect(detail?.items[0]?.unitPriceMinor).toBe(100_000);
    expect(detail?.totalMinor).toBe(200_000);
  });

  it("writes exactly one SaleCompleted outbox event inside the sale transaction", async () => {
    const result = await createSale(saleInput());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const events = await db.outboxEvent.findMany({ where: { eventType: "SaleCompleted" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(result.sale.id);
    expect(events[0]?.publishedAt).toBeNull();
  });

  it("keeps payment references out of the event payload", async () => {
    const result = await createSale(
      saleInput({ payment: { method: "CARD", reference: "4242-secret-ref" } }),
    );
    expect(result.status).toBe("ok");

    const event = await db.outboxEvent.findFirst({ where: { eventType: "SaleCompleted" } });
    // An outbox row is replayable and readable by every future consumer.
    expect(JSON.stringify(event?.payload)).not.toContain("4242-secret-ref");
  });

  it("issues sequential per-store bill numbers", async () => {
    const first = await createSale(saleInput());
    const second = await createSale(saleInput());
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;

    expect(first.sale.billNumber).toBe("SA-000001");
    expect(second.sale.billNumber).toBe("SA-000002");
  });

  it("numbers each store's bills independently", async () => {
    const a = await createSale(saleInput());
    const b = await createSale(
      saleInput({
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        cashierUserId: IDS.ownerB,
        lines: [{ variantId: COMMERCE_IDS.variantB1, quantity: 1 }],
      }),
    );
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;

    expect(a.sale.billNumber).toBe("SA-000001");
    expect(b.sale.billNumber).toBe("SB-000001");
  });

  it("reports the sale as not yet posted to accounting", async () => {
    // No ERPNext adapter exists. Anything other than PENDING here would be a claim the
    // system cannot support.
    const result = await createSale(saleInput());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.sale.erpSyncStatus).toBe("PENDING");

    const stored = await db.sale.findUnique({ where: { id: result.sale.id } });
    expect(stored?.erpInvoiceId).toBeNull();
  });
});

/**
 * The eight mandated negative cases. Each one is a way a real POS loses money, leaks data
 * or corrupts its own records.
 */
describe("createSale — negative cases", () => {
  it("(1) refuses to sell another tenant's product", async () => {
    const result = await createSale(
      saleInput({ lines: [{ variantId: COMMERCE_IDS.variantB1, quantity: 1 }] }),
    );

    // Reported as unknown, not as forbidden: the lookup was tenant-scoped, so tenant A
    // cannot even learn that tenant B's variant exists.
    expect(result.status).toBe("unknown_variant");
    expect(await db.sale.count()).toBe(0);
  });

  it("(1b) refuses a cart that mixes its own product with another tenant's", async () => {
    const result = await createSale(
      saleInput({
        lines: [
          { variantId: COMMERCE_IDS.variantA1, quantity: 1 },
          { variantId: COMMERCE_IDS.variantB1, quantity: 1 },
        ],
      }),
    );
    expect(result.status).toBe("unknown_variant");
    expect(await db.sale.count()).toBe(0);
  });

  it("(2) refuses to create a sale in another tenant's store", async () => {
    const result = await createSale(saleInput({ storeId: IDS.storeB }));

    expect(result.status).toBe("forbidden");
    expect(await db.sale.count()).toBe(0);
    // And tenant B's bill counter was never touched.
    const storeB = await db.store.findUnique({ where: { id: IDS.storeB } });
    expect(storeB?.nextBillSeq).toBe(1);
  });

  it("(3) blocks a user with no selling role in the store", async () => {
    // staffA is a real tenant A user with no StoreMembership at all.
    const result = await createSale(saleInput({ cashierUserId: IDS.staffA }));

    expect(result.status).toBe("forbidden");
    expect(await db.sale.count()).toBe(0);
  });

  it("(3b) blocks a store membership whose role may not take money", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "VIEWER" },
    });

    const result = await createSale(saleInput({ cashierUserId: IDS.staffA }));
    expect(result.status).toBe("forbidden");
    expect(await db.sale.count()).toBe(0);
  });

  it("(3c) blocks a cashier who belongs to another tenant entirely", async () => {
    const result = await createSale(saleInput({ cashierUserId: IDS.ownerB }));
    expect(result.status).toBe("forbidden");
    expect(await db.sale.count()).toBe(0);
  });

  it("(4) a repeated request returns the original sale instead of ringing a second one", async () => {
    const key = freshKey("retry");

    const first = await createSale(saleInput({ idempotencyKey: key }));
    const second = await createSale(saleInput({ idempotencyKey: key }));

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;

    expect(second.duplicate).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect(second.sale.billNumber).toBe(first.sale.billNumber);

    expect(await db.sale.count()).toBe(1);
    // The customer must not be charged twice, and stock must move only once.
    const stock = await db.stockLevel.findUnique({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    expect(stock?.quantity).toBe(8);
    expect(await db.outboxEvent.count({ where: { eventType: "SaleCompleted" } })).toBe(1);
  });

  it("(4b) concurrent identical submissions still produce exactly one sale", async () => {
    // The real double-click: both requests miss the fast-path read, and only the unique
    // constraint decides the winner.
    const key = freshKey("concurrent");

    const [a, b] = await Promise.all([
      createSale(saleInput({ idempotencyKey: key })),
      createSale(saleInput({ idempotencyKey: key })),
    ]);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;

    expect(a.sale.id).toBe(b.sale.id);
    expect(await db.sale.count()).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "SaleCompleted" } })).toBe(1);
  });

  it("(4c) the same idempotency key in a different tenant is a different sale", async () => {
    // The key is unique per tenant, not globally: two businesses must never collide.
    const key = freshKey("shared");

    const a = await createSale(saleInput({ idempotencyKey: key }));
    const b = await createSale(
      saleInput({
        idempotencyKey: key,
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        cashierUserId: IDS.ownerB,
        lines: [{ variantId: COMMERCE_IDS.variantB1, quantity: 1 }],
      }),
    );

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(a.sale.id).not.toBe(b.sale.id);
    expect(await db.sale.count()).toBe(2);
  });

  it("(5) rejects invalid quantities rather than coercing them", async () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      const result = await createSale(
        saleInput({ lines: [{ variantId: COMMERCE_IDS.variantA1, quantity }] }),
      );
      expect(result.status).toBe("invalid_quantity");
    }
    expect(await db.sale.count()).toBe(0);

    // Stock is untouched: a rejected sale must not move inventory.
    const stock = await db.stockLevel.findUnique({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    expect(stock?.quantity).toBe(10);
  });

  it("(5b) rejects an empty cart", async () => {
    const result = await createSale(saleInput({ lines: [] }));
    expect(result.status).toBe("empty_cart");
    expect(await db.sale.count()).toBe(0);
  });

  it("(6) refuses to attach another tenant's customer", async () => {
    const result = await createSale(saleInput({ customerId: COMMERCE_IDS.customerB }));

    expect(result.status).toBe("unknown_customer");
    expect(await db.sale.count()).toBe(0);
  });

  it("(6b) refuses a customer id that does not exist", async () => {
    const result = await createSale(saleInput({ customerId: "c-does-not-exist" }));
    expect(result.status).toBe("unknown_customer");
    expect(await db.sale.count()).toBe(0);
  });

  it("(6c) accepts the tenant's own customer", async () => {
    const result = await createSale(saleInput({ customerId: COMMERCE_IDS.customerA }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const detail = await getSaleDetail({ tenantId: IDS.tenantA, saleId: result.sale.id });
    expect(detail?.customer?.name).toBe("Customer A");
  });

  it("(7) a failure inside the transaction leaves no partial sale", async () => {
    await withFailingSaleItemInsert(async () => {
      await expect(createSale(saleInput())).rejects.toThrow();
    });

    // Nothing survives: no sale, no items, no payment, no stock movement, and the bill
    // counter is back where it started.
    expect(await db.sale.count()).toBe(0);
    expect(await db.saleItem.count()).toBe(0);
    expect(await db.salePayment.count()).toBe(0);

    const stock = await db.stockLevel.findUnique({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    expect(stock?.quantity).toBe(10);

    const store = await db.store.findUnique({ where: { id: IDS.storeA } });
    expect(store?.nextBillSeq).toBe(1);
  });

  it("(8) no outbox event survives a rolled back sale", async () => {
    await withFailingSaleItemInsert(async () => {
      await expect(createSale(saleInput())).rejects.toThrow();
    });

    // This is the whole point of writing the event inside the business transaction: a sale
    // that did not happen must not produce an event telling downstream systems it did.
    expect(await db.outboxEvent.count({ where: { eventType: "SaleCompleted" } })).toBe(0);
    expect(await db.sale.count()).toBe(0);
  });

  it("(8b) a rolled back sale can be retried successfully afterwards", async () => {
    const key = freshKey("after-failure");

    await withFailingSaleItemInsert(async () => {
      await expect(createSale(saleInput({ idempotencyKey: key }))).rejects.toThrow();
    });

    // The failed attempt left no row, so the same key is free to be used — which is
    // exactly right, because the customer was never charged.
    const retry = await createSale(saleInput({ idempotencyKey: key }));
    expect(retry.status).toBe("ok");
    if (retry.status !== "ok") return;
    expect(retry.duplicate).toBe(false);
    expect(await db.sale.count()).toBe(1);
  });
});

describe("catalogue and customer reads are tenant-scoped", () => {
  it("never returns another tenant's products", async () => {
    const hits = await searchCatalog({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      query: "Shirt",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.sku.startsWith("A-"))).toBe(true);
  });

  it("finds nothing when searching for another tenant's barcode", async () => {
    const hits = await searchCatalog({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      query: "2000000000001",
    });
    expect(hits).toHaveLength(0);
  });

  it("reports stock as null when the variant has never been counted in this store", async () => {
    await db.stockLevel.deleteMany({ where: { variantId: COMMERCE_IDS.variantA1 } });
    const hits = await searchCatalog({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      query: "A-SHIRT-M",
    });
    // Null, not zero: "never counted" is a different fact from "none left".
    expect(hits[0]?.stockQuantity).toBeNull();
  });

  it("never returns another tenant's customers", async () => {
    const hits = await searchCustomers({ tenantId: IDS.tenantA, query: "Customer" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe("Customer A");
  });

  it("resolves a repeated phone number to the existing customer", async () => {
    const again = await createCustomer({
      tenantId: IDS.tenantA,
      name: "Different Name",
      phone: "+919000000001",
    });
    expect(again.status).toBe("ok");
    if (again.status !== "ok") return;
    expect(again.existing).toBe(true);
    expect(again.customer.id).toBe(COMMERCE_IDS.customerA);
    expect(await db.customer.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("lets two tenants each hold the same phone number", async () => {
    const created = await createCustomer({
      tenantId: IDS.tenantB,
      name: "B's Customer",
      phone: "+919000000001",
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    expect(created.existing).toBe(false);
  });
});

describe("sale history and bill reads are tenant-scoped", () => {
  it("lists only the caller's own sales", async () => {
    await createSale(saleInput());
    await createSale(
      saleInput({
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        cashierUserId: IDS.ownerB,
        lines: [{ variantId: COMMERCE_IDS.variantB1, quantity: 1 }],
      }),
    );

    const listA = await listSales({ tenantId: IDS.tenantA });
    expect(listA).toHaveLength(1);
    expect(listA[0]?.billNumber).toBe("SA-000001");
  });

  it("returns null for another tenant's sale rather than revealing it exists", async () => {
    const result = await createSale(saleInput());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const asOtherTenant = await getSaleDetail({ tenantId: IDS.tenantB, saleId: result.sale.id });
    expect(asOtherTenant).toBeNull();
  });

  it("finds a sale by bill number and by customer phone", async () => {
    await createSale(saleInput({ customerId: COMMERCE_IDS.customerA }));

    expect(await listSales({ tenantId: IDS.tenantA, query: "SA-000001" })).toHaveLength(1);
    expect(await listSales({ tenantId: IDS.tenantA, query: "9000000001" })).toHaveLength(1);
    expect(await listSales({ tenantId: IDS.tenantA, query: "nothing-matches" })).toHaveLength(0);
  });
});
