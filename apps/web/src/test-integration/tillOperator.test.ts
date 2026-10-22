import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { hashOpaqueToken } from "@/server/identity/token";
import { setPinForStaff } from "@/server/identity/approvalPin";
import { openPosSession, type PosSessionActor } from "@/server/pos/posSessionService";
import { clearTillOperator, resolveSeller, switchTillOperator } from "@/server/pos/tillOperator";
import { createSale } from "@/server/sales/saleService";
import { getRegister } from "@/server/pos/cashRegister";

/** Shared counter: one signed-in till, each salesman switches in with their own PIN. */

const owner: PosSessionActor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER", membershipRole: "OWNER" };
const TOKEN = "till-session-token-for-tests";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  // staffA becomes a cashier in store A (the seed leaves them without a membership).
  await db.storeMembership.create({ data: { tenantId: IDS.tenantA, storeId: IDS.storeA, userId: IDS.staffA, role: "CASHIER" } });
  await db.session.create({
    data: { userId: IDS.ownerA, tenantId: IDS.tenantA, tokenHash: hashOpaqueToken(TOKEN), expiresAt: new Date(Date.now() + 3_600_000), activeStoreId: IDS.storeA },
  });
});

afterAll(async () => {
  await resetDatabase();
});

async function counterShift() {
  const device = await db.posDevice.create({
    data: { tenantId: IDS.tenantA, storeId: IDS.storeA, name: "Counter", code: "C1", createdByUserId: IDS.ownerA, pairingCodeHash: "x", pairingExpiresAt: new Date(Date.now() + 100_000), activatedAt: new Date() },
    select: { id: true },
  });
  const res = await openPosSession({ actor: owner, posDeviceId: device.id, correlationId: "c" });
  if (res.status !== "ok") throw new Error(res.status);
  return res.session.id;
}

const base = { sessionToken: TOKEN, tenantId: IDS.tenantA, storeId: IDS.storeA };

describe("shared counter PIN switch", () => {
  it("bills go to the PIN-switched salesman on the counter's shift, and Day Close splits them", async () => {
    const shift = await counterShift();
    expect((await setPinForStaff({ tenantId: IDS.tenantA, storeId: IDS.storeA, actorUserId: IDS.ownerA, targetUserId: IDS.staffA, pin: "4826" })).status).toBe("ok");

    // Before anyone switches, bills are the signed-in owner's.
    expect(await resolveSeller({ ...base, signedInUserId: IDS.ownerA })).toEqual({ sellerUserId: IDS.ownerA, viaOperator: false });

    expect((await switchTillOperator({ ...base, userId: IDS.staffA, pin: "1111" })).status).toBe("wrong_pin");
    const ok = await switchTillOperator({ ...base, userId: IDS.staffA, pin: "4826" });
    expect(ok.status).toBe("ok");

    const seller = await resolveSeller({ ...base, signedInUserId: IDS.ownerA });
    expect(seller).toEqual({ sellerUserId: IDS.staffA, viaOperator: true });
    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: seller.sellerUserId,
      sharedCounter: seller.viaOperator,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      posSessionId: shift,
      correlationId: "c",
    });
    expect(sale.status).toBe("ok");
    const stored = await db.sale.findFirst({ where: { posSessionId: shift }, select: { cashierUserId: true } });
    expect(stored?.cashierUserId).toBe(IDS.staffA);

    const reg = await getRegister({ tenantId: IDS.tenantA, sessionId: shift });
    expect(reg!.sellers.map((s) => s.userId)).toEqual([IDS.staffA]);
    expect(reg!.taken.CASH).toBeGreaterThan(0);

    // Locking hands the till back to the signed-in user.
    await clearTillOperator(TOKEN);
    expect((await resolveSeller({ ...base, signedInUserId: IDS.ownerA })).sellerUserId).toBe(IDS.ownerA);
  });

  it("without the shared-counter flag a sale can't use someone else's shift; a cashier can't set PINs", async () => {
    const shift = await counterShift();
    const res = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.staffA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      posSessionId: shift,
      correlationId: "c",
    });
    expect(res.status).toBe("invalid_session");
    expect((await setPinForStaff({ tenantId: IDS.tenantA, storeId: IDS.storeA, actorUserId: IDS.staffA, targetUserId: IDS.staffA, pin: "4826" })).status).toBe("forbidden");
    // No PIN set: switching is refused without revealing why.
    expect((await switchTillOperator({ ...base, userId: IDS.staffA, pin: "4826" })).status).toBe("not_allowed");
  });
});
