import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import {
  closePosSession,
  currentSessionForDevice,
  openPosSession,
  type PosSessionActor,
} from "@/server/pos/posSessionService";
import { scanBarcode } from "@/server/sales/catalog";
import { createSale } from "@/server/sales/saleService";

/**
 * The retail counter, against real PostgreSQL.
 *
 * What is worth proving here is what a till actually does: a cashier opens a shift, scans
 * something, sells it, and hands over. Every check a client could lie about — whose shift, which
 * store, which till, which tenant — is proven to be made on the server.
 */

const CORR = "corr-pos";

const ownerA: PosSessionActor = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const staffA: PosSessionActor = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF",
  membershipRole: null,
};
const ownerB: PosSessionActor = {
  tenantId: IDS.tenantB,
  userId: IDS.ownerB,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};

let deviceA = "";
let deviceB = "";

/** An activated till, the only state a shift may be opened on. */
async function makeDevice(params: {
  tenantId: string;
  storeId: string;
  userId: string;
  code: string;
  activated?: boolean;
  disabled?: boolean;
}) {
  const device = await db.posDevice.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      name: `Till ${params.code}`,
      code: params.code,
      createdByUserId: params.userId,
      activatedAt: params.activated === false ? null : new Date(),
      disabledAt: params.disabled ? new Date() : null,
    },
    select: { id: true },
  });
  return device.id;
}


beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();

  deviceA = await makeDevice({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    userId: IDS.ownerA,
    code: "T1",
  });
  deviceB = await makeDevice({
    tenantId: IDS.tenantB,
    storeId: IDS.storeB,
    userId: IDS.ownerB,
    code: "T1",
  });
});

// ---------------------------------------------------------------------------------------------
// Shift lifecycle
// ---------------------------------------------------------------------------------------------

describe("opening a shift", () => {
  it("opens a shift on an activated till", async () => {
    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.session.isOpen).toBe(true);
    expect(result.session.closedAt).toBeNull();
    expect(result.session.storeId).toBe(IDS.storeA);
    expect(result.session.cashierUserId).toBe(IDS.ownerA);
    expect(result.resumed).toBe(false);
  });

  it("points the till at its open shift", async () => {
    const opened = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const device = await db.posDevice.findUniqueOrThrow({ where: { id: deviceA } });
    expect(device.activeSessionId).toBe(opened.session.id);
  });

  /**
   * A reloaded browser is not a second shift. Being told your own till is busy by your own
   * earlier self is the kind of thing that makes cashiers reboot terminals mid-queue.
   */
  it("resumes the caller's own shift rather than refusing", async () => {
    const first = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    const second = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });

    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.session.id).toBe(first.session.id);
    expect(second.resumed).toBe(true);
    expect(await db.posSession.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  /** Handing a till over without closing is exactly what a shift record exists to prevent. */
  it("refuses a second cashier on a till someone else has open", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    await openPosSession({ actor: ownerA, posDeviceId: deviceA, correlationId: CORR });

    const result = await openPosSession({
      actor: staffA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    expect(result.status).toBe("conflict");
    expect(await db.posSession.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("refuses a user with no selling authority at that store", async () => {
    const result = await openPosSession({
      actor: staffA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("refuses a till that has never been activated", async () => {
    const pending = await makeDevice({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      code: "T9",
      activated: false,
    });

    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: pending,
      correlationId: CORR,
    });
    expect(result.status).toBe("device_unavailable");
  });

  it("refuses a disabled till", async () => {
    const revoked = await makeDevice({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      code: "T8",
      disabled: true,
    });

    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: revoked,
      correlationId: CORR,
    });
    expect(result.status).toBe("device_unavailable");
  });

  it("writes an audit entry", async () => {
    await openPosSession({ actor: ownerA, posDeviceId: deviceA, correlationId: CORR });
    const entry = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "PosSessionOpened" },
    });
    expect(entry?.userId).toBe(IDS.ownerA);
  });
});

describe("closing a shift", () => {
  async function openShift() {
    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (result.status !== "ok") throw new Error("open failed");
    return result.session;
  }

  it("closes the shift and frees the till", async () => {
    const session = await openShift();
    const result = await closePosSession({
      actor: ownerA,
      sessionId: session.id,
      closingNote: "Handed over to evening staff",
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.session.isOpen).toBe(false);
    expect(result.session.closedAt).not.toBeNull();
    expect(result.session.closingNote).toBe("Handed over to evening staff");

    const device = await db.posDevice.findUniqueOrThrow({ where: { id: deviceA } });
    expect(device.activeSessionId).toBeNull();
  });

  /** The shift happened. Sales point at it, so the row survives and only the pointer moves. */
  it("keeps the shift row after closing", async () => {
    const session = await openShift();
    await closePosSession({ actor: ownerA, sessionId: session.id, correlationId: CORR });

    const row = await db.posSession.findUnique({ where: { id: session.id } });
    expect(row).not.toBeNull();
    expect(row?.closedAt).not.toBeNull();
  });

  it("allows a new shift once the till is free", async () => {
    const first = await openShift();
    await closePosSession({ actor: ownerA, sessionId: first.id, correlationId: CORR });

    const second = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.session.id).not.toBe(first.id);
    expect(second.resumed).toBe(false);
  });

  it("refuses to close a shift twice", async () => {
    const session = await openShift();
    await closePosSession({ actor: ownerA, sessionId: session.id, correlationId: CORR });

    const again = await closePosSession({
      actor: ownerA,
      sessionId: session.id,
      correlationId: CORR,
    });
    expect(again.status).toBe("conflict");
  });

  /** A shift left open by someone who went home must be closable by the store's owner. */
  it("lets the tenant owner close another cashier's shift", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const opened = await openPosSession({
      actor: staffA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const result = await closePosSession({
      actor: ownerA,
      sessionId: opened.session.id,
      correlationId: CORR,
    });
    expect(result.status).toBe("ok");
  });

  it("refuses a staff user closing someone else's shift", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const opened = await openShift();

    const result = await closePosSession({
      actor: staffA,
      sessionId: opened.id,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "forbidden" });
  });
});

describe("the current shift on a till", () => {
  it("reports the open shift", async () => {
    const opened = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const current = await currentSessionForDevice({
      tenantId: IDS.tenantA,
      posDeviceId: deviceA,
    });
    expect(current?.id).toBe(opened.session.id);
  });

  it("reports nothing once closed", async () => {
    const opened = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;
    await closePosSession({ actor: ownerA, sessionId: opened.session.id, correlationId: CORR });

    expect(
      await currentSessionForDevice({ tenantId: IDS.tenantA, posDeviceId: deviceA }),
    ).toBeNull();
  });

  it("reports nothing for another tenant's till", async () => {
    await openPosSession({ actor: ownerB, posDeviceId: deviceB, correlationId: CORR });
    expect(
      await currentSessionForDevice({ tenantId: IDS.tenantA, posDeviceId: deviceB }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------------------------

describe("two cashiers reaching for one till", () => {
  /**
   * The pointer makes this structural: whatever the interleaving, `pos_devices.activeSessionId`
   * holds one value, so at most one shift can be open.
   */
  it("leaves exactly one open shift", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });

    await Promise.allSettled([
      openPosSession({ actor: ownerA, posDeviceId: deviceA, correlationId: "c-1" }),
      openPosSession({ actor: staffA, posDeviceId: deviceA, correlationId: "c-2" }),
    ]);

    const open = await db.posSession.count({
      where: { tenantId: IDS.tenantA, posDeviceId: deviceA, closedAt: null },
    });
    expect(open).toBeLessThanOrEqual(1);

    const device = await db.posDevice.findUniqueOrThrow({ where: { id: deviceA } });
    if (open === 1) expect(device.activeSessionId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Tenant, store and device isolation
// ---------------------------------------------------------------------------------------------

describe("tenant, store and device isolation", () => {
  it("refuses another tenant's till", async () => {
    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceB,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "not_found", what: "device" });
  });

  it("answers a foreign till and a nonexistent till identically", async () => {
    const foreign = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceB,
      correlationId: CORR,
    });
    const missing = await openPosSession({
      actor: ownerA,
      posDeviceId: "no-such-device",
      correlationId: CORR,
    });
    expect(foreign).toEqual(missing);
  });

  it("refuses to close another tenant's shift", async () => {
    const opened = await openPosSession({
      actor: ownerB,
      posDeviceId: deviceB,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const result = await closePosSession({
      actor: ownerA,
      sessionId: opened.session.id,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "not_found", what: "session" });
  });

  /** Raw Prisma, bypassing every service. These are claims about PostgreSQL. */
  it("refuses a shift on another tenant's till at the database", async () => {
    await expect(
      db.posSession.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          posDeviceId: deviceB,
          cashierUserId: IDS.ownerA,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a shift in another tenant's store at the database", async () => {
    await expect(
      db.posSession.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          posDeviceId: deviceA,
          cashierUserId: IDS.ownerA,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a shift run by another tenant's cashier at the database", async () => {
    await expect(
      db.posSession.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          posDeviceId: deviceA,
          cashierUserId: IDS.ownerB,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a sale attributed to another tenant's shift at the database", async () => {
    const opened = await openPosSession({
      actor: ownerB,
      posDeviceId: deviceB,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    await expect(
      db.sale.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          billNumber: "X-1",
          cashierUserId: IDS.ownerA,
          subtotalMinor: 100,
          taxMinor: 0,
          totalMinor: 100,
          paidMinor: 100,
          idempotencyKey: "cross-session-1",
          posSessionId: opened.session.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

// ---------------------------------------------------------------------------------------------
// The scan path
// ---------------------------------------------------------------------------------------------

describe("scanning a barcode", () => {
  it("finds the item and its store balance", async () => {
    const item = await scanBarcode({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      barcode: "1000000000001",
    });

    expect(item).not.toBeNull();
    expect(item?.variantId).toBe(COMMERCE_IDS.variantA1);
    expect(item?.sku).toBe("A-SHIRT-M");
    expect(item?.isActive).toBe(true);
    expect(item?.stockQuantity).toBe(10);
  });

  it("returns null for an unknown barcode", async () => {
    expect(
      await scanBarcode({ tenantId: IDS.tenantA, storeId: IDS.storeA, barcode: "9999999999999" }),
    ).toBeNull();
  });

  /** Another tenant's barcode is indistinguishable from one that does not exist. */
  it("refuses another tenant's barcode", async () => {
    expect(
      await scanBarcode({ tenantId: IDS.tenantA, storeId: IDS.storeA, barcode: "2000000000001" }),
    ).toBeNull();
  });

  /**
   * A cashier who scans a withdrawn item deserves "not for sale", not "unknown barcode". The
   * item comes back flagged; refusing the sale is saleService's job.
   */
  it("returns a withdrawn item with its flag rather than hiding it", async () => {
    await db.productVariant.update({
      where: { id: COMMERCE_IDS.variantA1 },
      data: { isActive: false },
    });

    const item = await scanBarcode({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      barcode: "1000000000001",
    });
    expect(item).not.toBeNull();
    expect(item?.isActive).toBe(false);
  });

  it("reports null stock for a store that has never stocked the item, not zero", async () => {
    const fresh = await db.productVariant.create({
      data: {
        tenantId: IDS.tenantA,
        productId: COMMERCE_IDS.productA,
        sku: "NEVER-STOCKED",
        barcode: "1000000009999",
        priceMinor: 5000,
      },
    });

    const item = await scanBarcode({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      barcode: "1000000009999",
    });
    expect(item?.variantId).toBe(fresh.id);
    expect(item?.stockQuantity).toBeNull();
  });

  it("ignores an empty barcode rather than matching everything", async () => {
    expect(
      await scanBarcode({ tenantId: IDS.tenantA, storeId: IDS.storeA, barcode: "   " }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Selling within a shift
// ---------------------------------------------------------------------------------------------

describe("a sale rung up in a shift", () => {
  async function openShift() {
    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (result.status !== "ok") throw new Error("open failed");
    return result.session;
  }

  function saleInput(key: string, posSessionId?: string | null) {
    return {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: key,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" as const },
      posSessionId,
      correlationId: CORR,
    };
  }

  it("attributes the sale to the shift", async () => {
    const session = await openShift();
    const result = await createSale(saleInput("shift-sale-1", session.id));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const sale = await db.sale.findUniqueOrThrow({ where: { id: result.sale.id } });
    expect(sale.posSessionId).toBe(session.id);
  });

  /** Sales without a till remain valid — back-office sales and pre-POS history both exist. */
  it("still completes a sale with no shift at all", async () => {
    const result = await createSale(saleInput("no-shift-1", null));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const sale = await db.sale.findUniqueOrThrow({ where: { id: result.sale.id } });
    expect(sale.posSessionId).toBeNull();
  });

  it("still writes the SALE stock movement", async () => {
    const session = await openShift();
    const before = await db.stockLevel.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 },
    });

    await createSale(saleInput("shift-sale-2", session.id));

    const after = await db.stockLevel.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 },
    });
    expect(after.quantity).toBe(before.quantity - 1);

    const movement = await db.stockMovement.findFirst({
      where: { tenantId: IDS.tenantA, type: "SALE", variantId: COMMERCE_IDS.variantA1 },
    });
    expect(movement).not.toBeNull();
  });

  it("refuses a sale into a closed shift", async () => {
    const session = await openShift();
    await closePosSession({ actor: ownerA, sessionId: session.id, correlationId: CORR });

    const result = await createSale(saleInput("closed-shift-1", session.id));
    expect(result.status).toBe("invalid_session");
    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
  });

  it("refuses a sale into another tenant's shift", async () => {
    const opened = await openPosSession({
      actor: ownerB,
      posDeviceId: deviceB,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const result = await createSale(saleInput("foreign-shift-1", opened.session.id));
    expect(result.status).toBe("invalid_session");
  });

  /** Naming a colleague's shift does not put your sale in it. */
  it("refuses a sale into another cashier's shift", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const opened = await openPosSession({
      actor: staffA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    if (opened.status !== "ok") return;

    const result = await createSale(saleInput("other-cashier-1", opened.session.id));
    expect(result.status).toBe("invalid_session");
  });

  it("refuses a sale naming a shift that does not exist", async () => {
    const result = await createSale(saleInput("ghost-shift-1", "no-such-session"));
    expect(result.status).toBe("invalid_session");
  });

  /** Idempotency is unchanged by the shift: a replay is still one sale. */
  it("replays to the same sale within a shift", async () => {
    const session = await openShift();
    const first = await createSale(saleInput("replay-shift-1", session.id));
    const second = await createSale(saleInput("replay-shift-1", session.id));

    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.sale.id).toBe(first.sale.id);
    expect(second.duplicate).toBe(true);
    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("creates one sale when the same key is submitted concurrently in a shift", async () => {
    const session = await openShift();
    await Promise.all([
      createSale(saleInput("concurrent-shift-1", session.id)),
      createSale(saleInput("concurrent-shift-1", session.id)),
      createSale(saleInput("concurrent-shift-1", session.id)),
    ]);

    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  /**
   * The frozen P1-8 idempotency contract, documented rather than assumed.
   *
   * A replayed key returns the **original** sale even when the new payload differs. The
   * conflicting payload is *not* rejected — there is no 409 here — because `createSale`'s
   * fast path matches on the key alone, by design: "a double-click must look like success,
   * not a failure the operator retries again."
   *
   * This test exists to pin that behaviour and to prove the property that actually matters:
   * whatever the second caller sent, it produced no second sale, no second stock movement,
   * and no second outbox event. The undetected payload conflict is recorded as a named
   * architectural risk rather than quietly changed here.
   */
  it("returns the original sale when a key is replayed with a different payload", async () => {
    const session = await openShift();
    const key = "conflict-payload-1";

    const first = await createSale({
      ...saleInput(key, session.id),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });
    if (first.status !== "ok") throw new Error("first sale failed");

    const movementsAfterFirst = await db.stockMovement.count({
      where: { tenantId: IDS.tenantA, type: "SALE" },
    });

    // Same key, deliberately different cart: three of a different variant.
    const second = await createSale({
      ...saleInput(key, session.id),
      lines: [{ variantId: COMMERCE_IDS.variantA2, quantity: 3 }],
    });

    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;

    // The original wins, unchanged. The second payload is silently ignored, not applied.
    expect(second.sale.id).toBe(first.sale.id);
    expect(second.sale.totalMinor).toBe(first.sale.totalMinor);
    expect(second.duplicate).toBe(true);

    // And the business effects happened exactly once.
    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
    expect(
      await db.stockMovement.count({ where: { tenantId: IDS.tenantA, type: "SALE" } }),
    ).toBe(movementsAfterFirst);
    expect(
      await db.outboxEvent.count({
        where: { tenantId: IDS.tenantA, eventType: "SaleCompleted" },
      }),
    ).toBe(1);

    // The second variant was never touched, which is the concrete proof the conflicting
    // payload was not applied.
    const untouched = await db.stockMovement.count({
      where: { tenantId: IDS.tenantA, variantId: COMMERCE_IDS.variantA2, type: "SALE" },
    });
    expect(untouched).toBe(0);
  });

  /** The shift can be reconciled: its sales are findable by the shift alone. */
  it("collects a shift's sales", async () => {
    const session = await openShift();
    await createSale(saleInput("shift-collect-1", session.id));
    await createSale(saleInput("shift-collect-2", session.id));

    const sales = await db.sale.findMany({ where: { posSessionId: session.id } });
    expect(sales).toHaveLength(2);
  });
});

describe("capability gating", () => {
  /** Opening a till is a RETAIL operation. */
  it("refuses to open a shift when RETAIL is switched off", async () => {
    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA, capability: "RETAIL" },
      data: { enabled: false },
    });

    const result = await openPosSession({
      actor: ownerA,
      posDeviceId: deviceA,
      correlationId: CORR,
    });
    expect(result.status).toBe("capability_disabled");
    expect(await db.posSession.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
  });
});
