import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { hashPassword } from "@/server/identity/password";
import { approveVariance, closeAndCount, getRegister, payoutApprovalLevel, recordCashMovement } from "@/server/pos/cashRegister";
import { openTestTill } from "./till";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpTillVarianceAdapter } from "@/server/erp/tillVarianceAdapter";
import { setVarianceAccounts } from "@/server/pos/varianceAccounts";

/** E6 (owner 2026-10-14): pay-out limits with the approver's own PIN, judged per payee per shift. */

const MANAGER_ID = "u-mmmmmmmmmmmmmmmmmmmmmmmm";
const CASHIER_ID = "u-cccccccccccccccccccccccc";
const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const cashier = { tenantId: IDS.tenantA, userId: CASHIER_ID, tenantRole: "STAFF" as const };
const manager = { tenantId: IDS.tenantA, userId: MANAGER_ID, tenantRole: "STAFF" as const };
let till = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  const pinHash = await hashPassword("2468");
  for (const [id, name, role] of [
    [MANAGER_ID, "Meena Manager", "STORE_MANAGER"],
    [CASHIER_ID, "Chetan Cashier", "CASHIER"],
  ] as const) {
    await db.user.create({
      data: { id, tenantId: IDS.tenantA, email: `${id}@t.test`, name, passwordHash: "x", tenantRole: "STAFF", approvalPinHash: pinHash },
    });
    await db.storeMembership.create({ data: { tenantId: IDS.tenantA, userId: id, storeId: IDS.storeA, role } });
  }
  await db.user.update({ where: { id: IDS.ownerA }, data: { approvalPinHash: pinHash } });
  till = await openTestTill({ tenantId: IDS.tenantA, storeId: IDS.storeA, cashierUserId: CASHIER_ID, floatMinor: 5_000_000 });
});

afterAll(async () => {
  await resetDatabase();
});

function payOut(actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" }, amountMinor: number, payee: string, approval?: { approverUserId: string; pin: string }) {
  return recordCashMovement({
    actor,
    sessionId: till,
    kind: "PAY_OUT",
    amountMinor,
    reason: "Shop supplies",
    category: "PETTY_EXPENSE",
    payee,
    approval: approval ?? null,
    idempotencyKey: randomUUID(),
  });
}

describe("pay-out approval (E6)", () => {
  it("levels: up to Rs 2,000 none, above it manager, Rs 10,000 and up owner", () => {
    expect(payoutApprovalLevel(200_000)).toBe("NONE");
    expect(payoutApprovalLevel(200_001)).toBe("MANAGER");
    expect(payoutApprovalLevel(999_999)).toBe("MANAGER");
    expect(payoutApprovalLevel(1_000_000)).toBe("OWNER");
  });

  it("a cashier records a small pay-out alone, with category and payee", async () => {
    expect(await payOut(cashier, 150_000, "Ravi Tea Stall")).toEqual({ status: "ok" });
    const m = await db.cashMovement.findFirstOrThrow({ where: { sessionId: till } });
    expect(m).toMatchObject({ category: "PETTY_EXPENSE", payee: "Ravi Tea Stall", approvalLevel: "NONE", approvedByUserId: null });
  });

  it("above Rs 2,000 needs a manager's own PIN, and records who approved", async () => {
    expect(await payOut(cashier, 250_000, "Sharma Hardware")).toMatchObject({ status: "approval_required", level: "MANAGER" });
    expect(await payOut(cashier, 250_000, "Sharma Hardware", { approverUserId: MANAGER_ID, pin: "1111" })).toMatchObject({
      status: "approval_refused",
    });
    expect(await payOut(cashier, 250_000, "Sharma Hardware", { approverUserId: MANAGER_ID, pin: "2468" })).toEqual({ status: "ok" });
    const m = await db.cashMovement.findFirstOrThrow({ where: { sessionId: till } });
    expect(m).toMatchObject({ approvalLevel: "MANAGER", approvedByUserId: MANAGER_ID });
  });

  it("splitting one payment into small ones still needs approval", async () => {
    expect((await payOut(cashier, 150_000, "Sharma Hardware")).status).toBe("ok");
    // Same payee, different spacing and case: the running total is Rs 3,000.
    expect(await payOut(cashier, 150_000, "  sharma   hardware ")).toMatchObject({ status: "approval_required", level: "MANAGER" });
  });

  it("Rs 10,000 or more needs the owner; a manager's PIN is not enough", async () => {
    expect(await payOut(cashier, 1_000_000, "Landlord")).toMatchObject({ status: "approval_required", level: "OWNER" });
    expect(await payOut(cashier, 1_000_000, "Landlord", { approverUserId: MANAGER_ID, pin: "2468" })).toMatchObject({
      status: "approval_refused",
    });
    expect(await payOut(cashier, 1_000_000, "Landlord", { approverUserId: IDS.ownerA, pin: "2468" })).toEqual({ status: "ok" });
  });

  it("a manager can't approve their own pay-out; the owner re-confirms with their own PIN", async () => {
    expect(await payOut(manager, 300_000, "Courier", { approverUserId: MANAGER_ID, pin: "2468" })).toMatchObject({
      status: "approval_refused",
    });
    expect(await payOut(owner, 300_000, "Courier", { approverUserId: IDS.ownerA, pin: "2468" })).toEqual({ status: "ok" });
  });

  it("pay-ins need no approval, and pay-outs come off the drawer", async () => {
    await recordCashMovement({
      actor: cashier,
      sessionId: till,
      kind: "PAY_IN",
      amountMinor: 50_000,
      reason: "Change from bank",
      idempotencyKey: randomUUID(),
    });
    await payOut(cashier, 20_000, "Ravi Tea Stall");
    const reg = (await getRegister({ tenantId: IDS.tenantA, sessionId: till }))!;
    expect(reg.expected.CASH).toBe(5_000_000 + 50_000 - 20_000);
  });
});

describe("till difference approval (E4)", () => {
  it("a short count waits for a manager who didn't run or count the till; ERPNext posting waits for finance", async () => {
    const res = await closeAndCount({
      actor: cashier,
      sessionId: till,
      counted: { CASH: 4_990_000, UPI: 0, CARD: 0 },
      note: "Rs 100 short",
    });
    expect(res.status).toBe("ok");
    expect((await getRegister({ tenantId: IDS.tenantA, sessionId: till }))!.varianceStatus).toBe("PENDING_APPROVAL");

    // The cashier can't approve (not an approver, and they ran the till).
    expect((await approveVariance({ actor: cashier, sessionId: till, note: "fine" })).status).toBe("forbidden");
    expect((await approveVariance({ actor: manager, sessionId: till, note: "" })).status).toBe("validation_error");
    expect((await approveVariance({ actor: manager, sessionId: till, note: "Change given twice, checked CCTV" })).status).toBe("ok");
    const reg = (await getRegister({ tenantId: IDS.tenantA, sessionId: till }))!;
    expect(reg).toMatchObject({
      varianceStatus: "APPROVED",
      varianceApprovedByUserId: MANAGER_ID,
      variancePostingStatus: "AWAITING_ACCOUNT_MAPPING",
    });
    // Approving twice is refused.
    expect((await approveVariance({ actor: owner, sessionId: till, note: "again" })).status).toBe("conflict");
  });

  it("the person who counted can't approve their own difference", async () => {
    await closeAndCount({ actor: manager, sessionId: till, counted: { CASH: 5_010_000, UPI: 0, CARD: 0 }, note: "Extra Rs 100" });
    expect((await approveVariance({ actor: manager, sessionId: till, note: "mine" })).status).toBe("conflict");
    expect((await approveVariance({ actor: owner, sessionId: till, note: "Customer overpaid, will return" })).status).toBe("ok");
  });

  it("a clean count needs no approval", async () => {
    await closeAndCount({ actor: cashier, sessionId: till, counted: { CASH: 5_000_000, UPI: 0, CARD: 0 } });
    expect((await getRegister({ tenantId: IDS.tenantA, sessionId: till }))!.varianceStatus).toBe("NONE");
  });
});

describe("till difference posting to ERPNext (E4)", () => {
  const COMPANY = "co-aaaaaaaaaaaaaaaaaaaaaa1";
  beforeEach(async () => {
    const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
    await db.company.create({ data: { id: COMPANY, tenantId: IDS.tenantA, name: "Company One", code: "C1", currency: store.currency } });
    await db.store.update({ where: { id: IDS.storeA }, data: { companyId: COMPANY } });
    await db.tenant.update({ where: { id: IDS.tenantA }, data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" } });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
    await closeAndCount({ actor: cashier, sessionId: till, counted: { CASH: 4_990_000, UPI: 0, CARD: 0 }, note: "Rs 100 short" });
    await approveVariance({ actor: manager, sessionId: till, note: "Change given twice" });
  });

  it("waits for finance's account mapping, then posts one submitted Journal Entry", async () => {
    const t1 = new FakeErpTransport();
    expect(await new ErpTillVarianceAdapter(t1).syncVariance(IDS.tenantA, till, "c1")).toBeNull();
    expect(t1.sent).toHaveLength(0);
    expect((await db.posSession.findUniqueOrThrow({ where: { id: till } })).variancePostingStatus).toBe("AWAITING_ACCOUNT_MAPPING");

    const set = await setVarianceAccounts({
      actor: { ...owner, storeId: IDS.storeA },
      cashAccount: "Cash - AR",
      overShortAccount: "Cash Over Short - AR",
      reason: "Confirmed by CA",
    });
    expect(set).toEqual({ status: "ok", requeued: 1 });

    const t2 = new FakeErpTransport().script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Cash - AR", company: "Amburax Retail" } } },
      { kind: "respond", status: 200, body: { data: { name: "ACC-JV-0001" } } },
      { kind: "respond", status: 200, body: { data: {} } },
    );
    expect(await new ErpTillVarianceAdapter(t2).syncVariance(IDS.tenantA, till, "c2")).toBe("ACC-JV-0001");
    const post = t2.sent.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ company: "Amburax Retail", user_remark: `amburax-till-variance:${till}` });
    // Short by Rs 100: over/short is debited, cash credited.
    expect((post.body as { accounts: unknown[] }).accounts).toEqual([
      { account: "Cash Over Short - AR", debit_in_account_currency: 100, credit_in_account_currency: 0 },
      { account: "Cash - AR", debit_in_account_currency: 0, credit_in_account_currency: 100 },
    ]);
    expect(t2.sent.at(-1)).toMatchObject({ method: "PUT", body: { docstatus: 1 } });
    expect(await db.posSession.findUniqueOrThrow({ where: { id: till } })).toMatchObject({
      variancePostingStatus: "POSTED",
      varianceErpRef: "ACC-JV-0001",
    });
    // Once posted, a re-delivery sends nothing.
    const t3 = new FakeErpTransport();
    expect(await new ErpTillVarianceAdapter(t3).syncVariance(IDS.tenantA, till, "c3")).toBe("ACC-JV-0001");
    expect(t3.sent).toHaveLength(0);
  });

  it("only the owner or accountant sets the accounts, with a reason", async () => {
    expect(
      (await setVarianceAccounts({ actor: { ...cashier, storeId: IDS.storeA }, cashAccount: "A", overShortAccount: "B", reason: "why" }))
        .status,
    ).toBe("forbidden");
    expect(
      (await setVarianceAccounts({ actor: { ...owner, storeId: IDS.storeA }, cashAccount: "Cash - AR", overShortAccount: "Cash - AR", reason: "why" }))
        .status,
    ).toBe("validation_error");
  });
});
