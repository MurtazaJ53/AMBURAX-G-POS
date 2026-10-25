import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createSale } from "@/server/sales/saleService";
import { hashPassword } from "@/server/identity/password";
import { identityNotifier } from "@/server/identity/notifier";
import { confirmPhoneCode, sendPhoneCode } from "@/server/khata/phoneVerification";
import { setCustomerCreditHold, setCustomerCreditMode } from "@/server/khata/customerCreditOverride";
import { collectRepayment, getOpenBills } from "@/server/khata/repayment";

// Real bcryptjs at cost 12 runs several times per test here. On a busy machine during the full run
// that can pass the 30 s default; alone these tests finish in seconds. Same headroom the
// bcrypt-backed unit suites got in dbf1ba4. The hashing cost itself is not lowered.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** Khata end to end under the owner's Q5-Q10 decisions (2026-10-14), against real PostgreSQL. */

const T = IDS.tenantA;
const COMPANY = "co-aaaaaaaaaaaaaaaaaaaaaa1";
const owner = { tenantId: T, userId: IDS.ownerA, tenantRole: "OWNER" as const, storeId: IDS.storeA };
const actor = { tenantId: T, userId: IDS.ownerA };
let customerId = "";
let lastCode = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
  await db.company.create({ data: { id: COMPANY, tenantId: T, name: "Company One", code: "C1", currency: store.currency } });
  await db.store.update({ where: { id: IDS.storeA }, data: { companyId: COMPANY } });
  const c = await db.customer.create({ data: { tenantId: T, name: "Ananya", phone: "+919876543210" } });
  customerId = c.id;
  vi.spyOn(identityNotifier, "sendOtp").mockImplementation(async ({ code }) => {
    lastCode = code;
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

/** One unit, the given amount on account (udhar), nothing else collected. */
function udhar(onAccountMinor: number, creditApproval?: { approverUserId: string; pin: string }) {
  return createSale({
    tenantId: T,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    customerId,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    onAccountMinor,
    creditApproval,
    correlationId: "c",
  });
}

/** The real bill total for one unit, from a cash sale. */
async function unitTotal() {
  const cash = await createSale({
    tenantId: T,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    payment: { method: "CASH" },
    correlationId: "c",
  });
  if (cash.status !== "ok") throw new Error(`cash sale failed: ${cash.status}`);
  return cash.sale.totalMinor;
}

async function verifyPhone() {
  expect((await sendPhoneCode({ actor, customerId })).status).toBe("ok");
  expect((await confirmPhoneCode({ actor, customerId, code: lastCode })).status).toBe("ok");
}

async function enableCredit(limitMinor: number) {
  const res = await setCustomerCreditMode({
    actor: owner,
    customerId,
    mode: "LIMITED",
    limitMinor,
    reason: "Regular buyer",
    correlationId: "c",
  });
  expect(res.status).toBe("ok");
}

describe("credit at the till (Q5, Q8, Q9, Q10)", () => {
  it("is off by default, needs a verified phone, then posts within the limit", async () => {
    const total = await unitTotal();
    // Default account: Rs 0 / blocked.
    expect(await udhar(total)).toMatchObject({ status: "credit_facility_unavailable" });

    await enableCredit(total * 3);
    const unverified = await udhar(total);
    // Not a dead end (owner 2026-10-20): the till is told a manager's PIN can approve it.
    expect(unverified).toMatchObject({ status: "credit_facility_unavailable", needsApproval: true });
    if (unverified.status === "credit_facility_unavailable") expect(unverified.reason).toMatch(/one-time code/);

    await verifyPhone();
    expect((await udhar(total)).status).toBe("ok");
    expect((await getOpenBills({ tenantId: T, storeId: IDS.storeA, customerId }))!.totalMinor).toBe(total);

    // Two more units would exceed the remaining limit: refused, nothing written.
    const before = await db.sale.count();
    const over = await createSale({
      tenantId: T,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      customerId,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
      onAccountMinor: total * 3,
      correlationId: "c",
    });
    expect(over).toMatchObject({ status: "credit_facility_unavailable" });
    expect(await db.sale.count()).toBe(before);
  });

  it("a wrong code doesn't verify, and five wrong codes lock the challenge", async () => {
    await sendPhoneCode({ actor, customerId });
    const wrong = lastCode === "000000" ? "111111" : "000000";
    expect((await confirmPhoneCode({ actor, customerId, code: wrong })).status).toBe("wrong_code");
    for (let i = 0; i < 4; i++) await confirmPhoneCode({ actor, customerId, code: wrong });
    expect((await confirmPhoneCode({ actor, customerId, code: lastCode })).status).toBe("too_many_attempts");
    expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).phoneVerifiedAt).toBeNull();
  });

  it("an overdue bill does not block new udhar (owner Q8, 2026-10-20); a hold still does", async () => {
    const total = await unitTotal();
    await enableCredit(total * 5);
    await verifyPhone();
    expect((await udhar(total)).status).toBe("ok");
    await db.sale.updateMany({
      where: { customerId, initialOnAccountMinor: { gt: 0 } },
      data: { dueDateSnapshot: new Date(Date.now() - 86_400_000) },
    });
    expect((await udhar(total)).status).toBe("ok");
    expect(await unitTotal()).toBeGreaterThan(0);

    await db.sale.updateMany({ where: { customerId }, data: { dueDateSnapshot: new Date(Date.now() + 86_400_000) } });
    await setCustomerCreditHold({ actor: owner, customerId, hold: true, reason: "Disputed bill", correlationId: "c" });
    expect(await udhar(total)).toMatchObject({ status: "credit_facility_unavailable" });
  });

  it("an unverified phone gets udhar on an owner/manager PIN; a wrong PIN or a cashier's PIN doesn't", async () => {
    const total = await unitTotal();
    await enableCredit(total * 5);
    await db.user.update({ where: { id: IDS.ownerA }, data: { approvalPinHash: await hashPassword("7391") } });

    const wrong = await udhar(total, { approverUserId: IDS.ownerA, pin: "1111" });
    expect(wrong).toMatchObject({ status: "credit_facility_unavailable", needsApproval: true });
    if (wrong.status === "credit_facility_unavailable") expect(wrong.reason).toMatch(/Wrong PIN/);

    await db.user.update({ where: { id: IDS.staffA }, data: { approvalPinHash: await hashPassword("5182") } });
    expect((await udhar(total, { approverUserId: IDS.staffA, pin: "5182" })).status).toBe("credit_facility_unavailable");

    const approved = await udhar(total, { approverUserId: IDS.ownerA, pin: "7391" });
    expect(approved.status).toBe("ok");
    if (approved.status === "ok") {
      const audit = await db.auditLog.findFirst({ where: { action: "SaleCompleted", metadata: { path: ["saleId"], equals: approved.sale.id } } });
      expect(audit?.metadata).toMatchObject({ udharApprovedByUserId: IDS.ownerA });
    }
  });

  it("only the owner or accountant changes credit, always with a reason", async () => {
    const staff = { ...owner, userId: IDS.staffA, tenantRole: "STAFF" as const };
    expect(
      (await setCustomerCreditMode({ actor: staff, customerId, mode: "LIMITED", limitMinor: 100, reason: "x y z", correlationId: "c" })).status,
    ).toBe("forbidden");
    expect(
      (await setCustomerCreditMode({ actor: owner, customerId, mode: "LIMITED", limitMinor: 100, reason: "", correlationId: "c" })).status,
    ).toBe("validation_error");
  });
});

describe("repayment (Q6, Q7)", () => {
  async function twoBills() {
    const total = await unitTotal();
    await enableCredit(total * 10);
    await verifyPhone();
    const first = await udhar(total);
    const second = await udhar(total);
    if (first.status !== "ok" || second.status !== "ok") throw new Error("udhar failed");
    // The first bill falls due first.
    await db.sale.update({ where: { id: first.sale.id }, data: { dueDateSnapshot: new Date(Date.now() + 1 * 86_400_000) } });
    await db.sale.update({ where: { id: second.sale.id }, data: { dueDateSnapshot: new Date(Date.now() + 5 * 86_400_000) } });
    return { total, first: first.sale.id };
  }

  it("settles the oldest bill first", async () => {
    const { total, first } = await twoBills();
    const res = await collectRepayment({
      actor,
      storeId: IDS.storeA,
      customerId,
      method: "UPI",
      tenderedMinor: total - 1,
      reference: "UPI123",
      idempotencyKey: randomUUID(),
    });
    expect(res).toMatchObject({ status: "ok", appliedMinor: total - 1, changeMinor: 0, remainingMinor: total + 1 });
    if (res.status === "ok") expect(res.allocations).toEqual([expect.objectContaining({ saleId: first, amountMinor: total - 1 })]);
  });

  it("cash over the dues applies only what is owed and gives change; UPI over is refused", async () => {
    const { total } = await twoBills();
    expect(
      await collectRepayment({
        actor,
        storeId: IDS.storeA,
        customerId,
        method: "UPI",
        tenderedMinor: total * 2 + 100,
        reference: "UPI9",
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ status: "validation_error" });

    const key = randomUUID();
    const cash = await collectRepayment({ actor, storeId: IDS.storeA, customerId, method: "CASH", tenderedMinor: total * 2 + 500, idempotencyKey: key });
    expect(cash).toMatchObject({ status: "ok", appliedMinor: total * 2, changeMinor: 500, remainingMinor: 0 });
    // A retry records nothing new.
    const again = await collectRepayment({ actor, storeId: IDS.storeA, customerId, method: "CASH", tenderedMinor: total * 2 + 500, idempotencyKey: key });
    expect(again).toMatchObject({ status: "ok", duplicate: true });
    expect(await db.khataPayment.count()).toBe(1);
    expect((await getOpenBills({ tenantId: T, storeId: IDS.storeA, customerId }))!.totalMinor).toBe(0);
    expect(
      await collectRepayment({ actor, storeId: IDS.storeA, customerId, method: "CASH", tenderedMinor: 100, idempotencyKey: randomUUID() }),
    ).toMatchObject({ status: "nothing_due" });
  });
});
