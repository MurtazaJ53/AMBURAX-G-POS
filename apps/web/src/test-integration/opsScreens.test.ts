import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { openPosSession, type PosSessionActor } from "@/server/pos/posSessionService";
import { createSale } from "@/server/sales/saleService";
import { closeAndCount, getRegister, listDayClose, recordCashMovement, setOpeningFloat, todayIst } from "@/server/pos/cashRegister";
import { punch, roster, workedMinutes } from "@/server/staff/attendance";
import { listLocations } from "@/server/inventory/locations";
import { getCustomerSegments } from "@/server/sales/customerSegments";
import { getCustomerHistory } from "@/server/sales/customerHistory";

/** Screens 35, 39-40, 51-54 against real PostgreSQL. */

const owner: PosSessionActor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER", membershipRole: "OWNER" };
const ownerB = { tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: "OWNER" as const };
const staffA = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

async function openShift() {
  const device = await db.posDevice.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      name: "Till 1",
      code: "T1",
      createdByUserId: IDS.ownerA,
      pairingCodeHash: "x",
      pairingExpiresAt: new Date(Date.now() + 100_000),
      activatedAt: new Date(),
    },
    select: { id: true },
  });
  const res = await openPosSession({ actor: owner, posDeviceId: device.id, correlationId: "c" });
  if (res.status !== "ok") throw new Error(`open failed: ${res.status}`);
  return res.session.id;
}

async function cashSale(sessionId: string, customerId?: string) {
  const res = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    payment: { method: "CASH" },
    posSessionId: sessionId,
    customerId,
    correlationId: "c",
  });
  if (res.status !== "ok") throw new Error(`sale failed: ${res.status}`);
  return res.sale;
}

describe("cash register and day close (53-54)", () => {
  it("a sale with no shift named joins the cashier's one open shift, so the close count includes it", async () => {
    const id = await openShift();
    const res = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "UPI" },
      correlationId: "c",
    });
    expect(res.status).toBe("ok");
    const reg = await getRegister({ tenantId: IDS.tenantA, sessionId: id });
    expect(reg!.expected.UPI).toBeGreaterThan(0);
    // Another cashier's sale is not pulled into this shift.
    const other = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.staffA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "UPI" },
      correlationId: "c",
    });
    if (other.status === "ok") {
      expect((await getRegister({ tenantId: IDS.tenantA, sessionId: id }))!.expected.UPI).toBe(reg!.expected.UPI);
    }
  });

  it("expected cash = float + cash taken + paid in − paid out, and a matching count closes cleanly", async () => {
    const id = await openShift();
    expect((await setOpeningFloat({ actor: owner, sessionId: id, amountMinor: 200_000 })).status).toBe("ok");
    expect((await setOpeningFloat({ actor: owner, sessionId: id, amountMinor: 1 })).status).toBe("conflict");
    const sale = await cashSale(id);
    const key = randomUUID();
    await recordCashMovement({ actor: owner, sessionId: id, kind: "PAY_IN", amountMinor: 50_000, reason: "Change from bank", idempotencyKey: key });
    // A retried pay-in is recorded once.
    await recordCashMovement({ actor: owner, sessionId: id, kind: "PAY_IN", amountMinor: 50_000, reason: "Change from bank", idempotencyKey: key });
    await recordCashMovement({
      actor: owner,
      sessionId: id,
      kind: "PAY_OUT",
      amountMinor: 10_000,
      reason: "Tea for staff",
      category: "PETTY_EXPENSE",
      payee: "Ravi Tea Stall",
      idempotencyKey: randomUUID(),
    });

    const reg = (await getRegister({ tenantId: IDS.tenantA, sessionId: id }))!;
    expect(reg.paidIn).toBe(50_000);
    expect(reg.expected.CASH).toBe(200_000 + sale.totalMinor + 50_000 - 10_000);

    const res = await closeAndCount({ actor: owner, sessionId: id, counted: { CASH: reg.expected.CASH, UPI: 0, CARD: 0 } });
    expect(res.status).toBe("ok");
    const closed = (await getRegister({ tenantId: IDS.tenantA, sessionId: id }))!;
    expect(closed.closedAt).not.toBeNull();
    expect(closed.counts.every((c) => c.differenceMinor === 0)).toBe(true);
    expect((await db.posDevice.findFirstOrThrow({ where: { tenantId: IDS.tenantA } })).activeSessionId).toBeNull();
  });

  it("a short drawer needs a note, and the difference is kept", async () => {
    const id = await openShift();
    await setOpeningFloat({ actor: owner, sessionId: id, amountMinor: 100_000 });
    const noNote = await closeAndCount({ actor: owner, sessionId: id, counted: { CASH: 90_000, UPI: 0, CARD: 0 } });
    expect(noNote.status).toBe("validation_error");
    const ok = await closeAndCount({ actor: owner, sessionId: id, counted: { CASH: 90_000, UPI: 0, CARD: 0 }, note: "Gave change twice" });
    expect(ok.status).toBe("ok");
    const day = await listDayClose({ tenantId: IDS.tenantA, storeId: IDS.storeA, date: todayIst() });
    expect(day.totals.difference).toBe(-10_000);
    expect(day.registers).toHaveLength(1);
  });

  it("refuses a pay-out larger than the drawer, and strangers to the shift", async () => {
    const id = await openShift();
    await setOpeningFloat({ actor: owner, sessionId: id, amountMinor: 5_000 });
    const big = await recordCashMovement({
      actor: owner,
      sessionId: id,
      kind: "PAY_OUT",
      amountMinor: 6_000,
      reason: "Too much",
      category: "PETTY_EXPENSE",
      payee: "Ravi Tea Stall",
      idempotencyKey: randomUUID(),
    });
    expect(big.status).toBe("validation_error");
    expect((await setOpeningFloat({ actor: staffA, sessionId: id, amountMinor: 0 })).status).toBe("forbidden");
    expect(await getRegister({ tenantId: IDS.tenantB, sessionId: id })).toBeNull();
  });
});

describe("attendance (51)", () => {
  it("clocks in and out in order and counts the minutes", async () => {
    const t0 = new Date();
    expect((await punch({ actor: owner, storeId: IDS.storeA, logType: "OUT", now: t0 })).status).toBe("conflict");
    expect((await punch({ actor: owner, storeId: IDS.storeA, logType: "IN", now: t0 })).status).toBe("ok");
    // A double tap is one punch.
    expect((await punch({ actor: owner, storeId: IDS.storeA, logType: "IN", now: new Date(t0.getTime() + 5_000) })).status).toBe("ok");
    expect(await db.staffCheckin.count()).toBe(1);
    const rows = await roster({ tenantId: IDS.tenantA, storeId: IDS.storeA, date: todayIst(t0), now: new Date(t0.getTime() + 90 * 60_000) });
    expect(rows.find((r) => r.userId === IDS.ownerA)).toMatchObject({ state: "in" });
    expect(rows.find((r) => r.userId === IDS.ownerA)!.minutes).toBeGreaterThan(0);
  });

  it("someone with no place in the store can't clock in there", async () => {
    expect((await punch({ actor: staffA, storeId: IDS.storeA, logType: "IN" })).status).toBe("forbidden");
    expect((await punch({ actor: ownerB, storeId: IDS.storeA, logType: "IN" })).status).toBe("forbidden");
  });

  it("adds up IN/OUT pairs", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 4, m));
    expect(
      workedMinutes(
        [
          { logType: "IN", at: at(0) },
          { logType: "OUT", at: at(30) },
          { logType: "IN", at: at(40) },
          { logType: "OUT", at: at(55) },
        ],
        at(59),
      ),
    ).toBe(45);
  });
});

describe("locations, customer history and segments (35, 39, 40)", () => {
  it("lists only the viewer's tenant's stores with their stock", async () => {
    const rows = await listLocations(owner);
    expect(rows.map((r) => r.storeId)).toEqual([IDS.storeA]);
    expect(rows[0]!.units).toBeGreaterThan(0);
  });

  it("history and segments follow a customer's bills", async () => {
    const customer = await db.customer.create({ data: { tenantId: IDS.tenantA, name: "Ananya" } });
    const idle = await db.customer.create({ data: { tenantId: IDS.tenantA, name: "Never Bought" } });
    const id = await openShift();
    await cashSale(id, customer.id);
    await cashSale(id, customer.id);

    const h = await getCustomerHistory({ tenantId: IDS.tenantA, customerId: customer.id });
    expect(h.total).toBe(2);
    expect(h.topItems[0]).toMatchObject({ variantId: COMMERCE_IDS.variantA1, units: 2, bills: 2 });
    expect((await getCustomerHistory({ tenantId: IDS.tenantB, customerId: customer.id })).total).toBe(0);

    const seg = await getCustomerSegments({ tenantId: IDS.tenantA, days: 30 });
    const byId = new Map(seg.customers.map((c) => [c.id, c]));
    expect(byId.get(customer.id)).toMatchObject({ segment: "new", billsInWindow: 2 });
    expect(byId.get(idle.id)).toMatchObject({ segment: "never", billsInWindow: 0 });

    // A year from now the same customer has lapsed.
    const later = await getCustomerSegments({ tenantId: IDS.tenantA, days: 30, now: new Date(Date.now() + 365 * 86_400_000) });
    expect(later.customers.find((c) => c.id === customer.id)?.segment).toBe("lapsed");
  });
});
