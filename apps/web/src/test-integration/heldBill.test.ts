import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { 
  createHeldBill, 
  listHeldBills, 
  getHeldBill, 
  resumeHeldBill, 
  discardHeldBill 
} from "@/server/sales/heldBillService";

describe("HeldBill Service (Integration)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    await seedCommerce();
  });

  it("1, 4. creates held bill and persists items correctly", async () => {
    const input = {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-create-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
    };

    const res = await createHeldBill(input);
    expect(res.status).toBe("ok");
    expect(res.duplicate).toBe(false);
    expect(res.heldBill.tenantId).toBe(IDS.tenantA);
    expect(res.heldBill.items).toHaveLength(1);
    expect(res.heldBill.items[0]!.quantity).toBe(2);

    const listed = await listHeldBills({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(res.heldBill.id);
  });

  it("2, 3. tenant isolation and store-wide visibility", async () => {
    const input = {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-create-iso-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    };

    const created = await createHeldBill(input);

    // Tenant B cannot see it even if checking Tenant A's store 
    // (though in practice they shouldn't even know storeA)
    const listB = await listHeldBills({ tenantId: IDS.tenantB, storeId: IDS.storeA });
    expect(listB).toHaveLength(0);

    // Store B of Tenant A cannot see it
    const listA_StoreB = await listHeldBills({ tenantId: IDS.tenantA, storeId: IDS.storeB });
    expect(listA_StoreB).toHaveLength(0);

    // Authorized user in the SAME store CAN see it (Store-wide visibility)
    const listA_StoreA_Staff = await listHeldBills({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(listA_StoreA_Staff).toHaveLength(1);
    expect(listA_StoreA_Staff[0]!.id).toBe(created.heldBill.id);
  });

  it("12. idempotency creates exactly once", async () => {
    const input = {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-idem-key",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
    };

    const first = await createHeldBill(input);
    expect(first.duplicate).toBe(false);

    const second = await createHeldBill(input);
    expect(second.duplicate).toBe(true);
    expect(second.heldBill.id).toBe(first.heldBill.id);

    const count = await db.heldBill.count();
    expect(count).toBe(1);
  });

  it("5, 6. 24h expiry and expired hold rejection", async () => {
    const created = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-exp-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });

    // Manually backdate the held bill to 25 hours ago
    await db.heldBill.update({
      where: { id: created.heldBill.id },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      }
    });

    // Should not appear in list
    const list = await listHeldBills({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(list).toHaveLength(0);

    // Should be rejected for claiming
    await expect(resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.ownerA,
      expectedVersion: 0,
    })).rejects.toThrow(/expired/i);
  });

  it("7. successful claim", async () => {
    const created = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-claim-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });

    const res = await resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.ownerA,
      expectedVersion: 0,
    });

    expect(res.status).toBe("ok");
    expect(res.heldBill.resumedAt).not.toBeNull();
    expect(res.heldBill.resumedByUserId).toBe(IDS.ownerA);
    expect(res.heldBill.version).toBe(1);

    // No longer in active list
    const list = await listHeldBills({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(list).toHaveLength(0);
  });

  it("8, 11. concurrent claim (only one winner) & version conflict", async () => {
    const created = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-conc-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });

    // First resume wins
    await resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.ownerA,
      expectedVersion: 0,
    });

    // Second resume fails with version mismatch / terminal state
    await expect(resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.staffA,
      expectedVersion: 0,
    })).rejects.toThrow();
  });

  it("9, 10. discard and terminal-state protection", async () => {
    const created = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-discard-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });

    const res = await discardHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      discardedByUserId: IDS.ownerA,
      expectedVersion: 0,
    });

    expect(res.status).toBe("ok");

    // Cannot resume a discarded bill
    await expect(resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.ownerA,
      expectedVersion: 1, // Even with correct updated version
    })).rejects.toThrow();

    // Cannot discard it again
    await expect(discardHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      discardedByUserId: IDS.ownerA,
      expectedVersion: 1,
    })).rejects.toThrow();
  });

  it("13, 14, 15, 16, 17. no Sale, Payment, or StockMovement creation", async () => {
    const saleCountBefore = await db.sale.count();
    const paymentCountBefore = await db.salePayment.count();
    const stockCountBefore = await db.stockMovement.count();

    const created = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hb-nosale-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 5 }],
    });

    await resumeHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      id: created.heldBill.id,
      resumedByUserId: IDS.ownerA,
      expectedVersion: 0,
    });

    const saleCountAfter = await db.sale.count();
    const paymentCountAfter = await db.salePayment.count();
    const stockCountAfter = await db.stockMovement.count();

    expect(saleCountAfter).toBe(saleCountBefore);
    expect(paymentCountAfter).toBe(paymentCountBefore);
    expect(stockCountAfter).toBe(stockCountBefore);
  });
});
