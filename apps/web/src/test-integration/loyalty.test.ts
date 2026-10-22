import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import {
  LOYALTY_SIGNOFF,
  LoyaltyShortError,
  balance,
  earnForSale,
  expirePoints,
  loyaltyLive,
  maxRedeemablePoints,
  pointsFor,
  redeemOnSale,
  reverseForReturn,
  saveProgram,
  settleCreditSale,
  DEFAULT_PROGRAM,
  onCreditBillSettled,
  onSaleCompleted,
} from "@/server/loyalty/loyalty";

/** Decision 41: the loyalty ledger, built but not live. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const staff = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const DAY = 86_400_000;

let customerId: string;
async function program() {
  const res = await saveProgram({ actor: owner, rules: { ...DEFAULT_PROGRAM } });
  if (res.status !== "ok") throw new Error(res.status);
  return res.program;
}
const bal = async (programId: string, now?: Date) => balance({ tenantId: IDS.tenantA, customerId, programId, now });

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  customerId = (await db.customer.create({ data: { tenantId: IDS.tenantA, name: "Asha" } })).id;
});

afterAll(async () => {
  await resetDatabase();
});

describe("loyalty is off until finance and GST sign off", () => {
  it("a saved, enabled program is still not live", async () => {
    expect(LOYALTY_SIGNOFF).toEqual({ finance: false, gst: false });
    const p = await program();
    expect(p.enabled).toBe(false);
    expect(loyaltyLive({ ...p, enabled: true })).toBe(false);
  });

  it("only the owner sets rules, within bounds, and every save is audited", async () => {
    expect((await saveProgram({ actor: staff, rules: { ...DEFAULT_PROGRAM } })).status).toBe("forbidden");
    expect((await saveProgram({ actor: owner, rules: { ...DEFAULT_PROGRAM, maxRedeemBp: 10_001 } })).status).toBe("validation_error");
    await program();
    expect(await db.auditLog.count({ where: { action: "LoyaltyProgramSaved" } })).toBe(1);
  });
});

describe("rules", () => {
  it("1 point per Rs 100 net excluding GST, rounded down; 10% cap at Rs 1 a point", () => {
    expect(pointsFor(99_99, DEFAULT_PROGRAM)).toBe(0);
    expect(pointsFor(250_00, DEFAULT_PROGRAM)).toBe(2);
    expect(maxRedeemablePoints(1_500_00, DEFAULT_PROGRAM)).toBe(150);
  });

  it("redeems oldest-expiring first, enforces the minimum and the cap, and can't overspend", async () => {
    const p = await program();
    const t0 = new Date();
    await db.$transaction((tx) => earnForSale(tx, { program: p, customerId, saleId: "s1", eligibleNetMinor: 10_000_00, onCredit: false, now: new Date(t0.getTime() - 30 * DAY) }));
    await db.$transaction((tx) => earnForSale(tx, { program: p, customerId, saleId: "s2", eligibleNetMinor: 10_000_00, onCredit: false, now: t0 }));
    // Same sale twice is one earn.
    await db.$transaction((tx) => earnForSale(tx, { program: p, customerId, saleId: "s2", eligibleNetMinor: 10_000_00, onCredit: false, now: t0 }));
    expect((await bal(p.id)).available).toBe(200);

    const redeem = (points: number, eligibleMinor: number, saleId = "r1") =>
      db.$transaction((tx) => redeemOnSale(tx, { program: p, customerId, saleId, points, eligibleMinor }));
    expect(await redeem(99, 5_000_00)).toMatchObject({ status: "validation_error" });
    expect(await redeem(150, 1_000_00)).toMatchObject({ status: "validation_error" }); // cap is 100
    expect(await redeem(150, 2_000_00)).toEqual({ status: "ok", points: 150, valueMinor: 150_00 });
    const lots = await db.loyaltyLedgerEntry.findMany({ where: { type: "EARN" }, orderBy: { saleId: "asc" } });
    expect(lots.map((l) => l.remaining)).toEqual([0, 50]);
    await expect(redeem(100, 5_000_00, "r2")).rejects.toBeInstanceOf(LoyaltyShortError);
    expect((await bal(p.id)).available).toBe(50);
  });

  it("credit-sale points wait until settled, then expire after 12 months", async () => {
    const p = await program();
    await db.$transaction((tx) => earnForSale(tx, { program: p, customerId, saleId: "c1", eligibleNetMinor: 500_00, onCredit: true }));
    expect(await bal(p.id)).toEqual({ available: 0, pending: 5 });
    expect((await settleCreditSale({ tenantId: IDS.tenantA, saleId: "c1" })).posted).toBe(5);
    expect(await bal(p.id)).toEqual({ available: 5, pending: 0 });

    const later = new Date(Date.now() + 366 * DAY);
    expect((await bal(p.id, later)).available).toBe(0);
    expect((await expirePoints({ tenantId: IDS.tenantA, now: later })).expired).toBe(5);
    expect(await db.loyaltyLedgerEntry.count({ where: { type: "EXPIRE", points: -5 } })).toBe(1);
  });
});

describe("returns reverse with compensating entries", () => {
  it("half a bill returned takes back half its points and gives back half the redeemed points", async () => {
    const p = await program();
    await db.$transaction((tx) => earnForSale(tx, { program: p, customerId, saleId: "old", eligibleNetMinor: 20_000_00, onCredit: false }));
    await db.$transaction(async (tx) => {
      await redeemOnSale(tx, { program: p, customerId, saleId: "s", points: 100, eligibleMinor: 2_000_00 });
      await earnForSale(tx, { program: p, customerId, saleId: "s", eligibleNetMinor: 1_900_00, onCredit: false });
    });
    expect((await bal(p.id)).available).toBe(119);

    const ret = () =>
      db.$transaction((tx) =>
        reverseForReturn(tx, { tenantId: IDS.tenantA, saleId: "s", returnId: "ret1", returnedMinor: 1_000_00, saleEligibleMinor: 2_000_00 }),
      );
    expect(await ret()).toEqual({ reversedEarn: 9, restoredRedeem: 50, unrecovered: 0 });
    // A retried return changes nothing.
    await ret();
    expect((await bal(p.id)).available).toBe(119 - 9 + 50);
    // Nothing was edited away: every row for the sale is still there.
    expect(await db.loyaltyLedgerEntry.count({ where: { saleId: "s" } })).toBe(4);
  });
});

describe("checkout hooks are wired but inert before sign-off", () => {
  it("an enabled program earns nothing on a sale while LOYALTY_SIGNOFF is off", async () => {
    const p = await program();
    await db.loyaltyProgram.update({ where: { id: p.id }, data: { enabled: true } });
    await db.$transaction((tx) =>
      onSaleCompleted(tx, { tenantId: IDS.tenantA, id: "s-live", customerId, currency: "INR", totalMinor: 5_900_00, taxMinor: 900_00, onAccountMinor: 0 }),
    );
    await db.$transaction((tx) => onCreditBillSettled(tx, { tenantId: IDS.tenantA, saleId: "s-live", currency: "INR" }));
    expect(await db.loyaltyLedgerEntry.count()).toBe(0);
  });
});
