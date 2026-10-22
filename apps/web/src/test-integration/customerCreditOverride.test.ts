import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";

// Wrap the real audit writer so one test can make it fail inside the transaction.
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/identity/audit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/identity/audit")>();
  return {
    ...real,
    writeAuditLogTx: async (...args: Parameters<typeof real.writeAuditLogTx>) => {
      if (auditControl.fail) throw new Error("audit write failed");
      return real.writeAuditLogTx(...args);
    },
  };
});

// Integration files share one module cache (isolate: false). If an earlier file already loaded the
// override module, it holds the real audit writer and the mock above never reaches it — the
// intermittent failure of the rollback test. Reset so the imports below pick up the mock.
vi.resetModules();
const { getCustomerCreditMode, setCustomerCreditMode } = await import("@/server/khata/customerCreditOverride");
const { findOrCreateCreditAccount } = await import("@/server/khata/creditAccount");

/**
 * Owner-only per-customer Udhar override against real PostgreSQL. Scope comes from the session's
 * Store; nothing here enables checkout or payments.
 */

const T = IDS.tenantA;
const COMPANY_1 = "co-override-aaaaaaaaaaa1";
const COMPANY_2 = "co-override-aaaaaaaaaaa2";
const STORE_2 = "s-override-aaaaaaaaaaaa2";

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; storeId: string };
const owner: Actor = { tenantId: T, userId: IDS.ownerA, tenantRole: "OWNER", storeId: IDS.storeA };
const staff: Actor = { ...owner, userId: IDS.staffA, tenantRole: "STAFF" };
let seq = 0;
const corr = () => `corr-override-${++seq}`;

const set = (mode: unknown, limitMinor: unknown, opts: { actor?: Actor; customerId?: string } = {}) =>
  setCustomerCreditMode({
    actor: opts.actor ?? owner,
    customerId: opts.customerId ?? COMMERCE_IDS.customerA,
    mode,
    limitMinor,
    reason: "Owner approved",
    correlationId: corr(),
  });

const accountOf = (customerId: string, companyId = COMPANY_1) =>
  db.customerCreditAccount.findUnique({ where: { tenantId_companyId_customerId: { tenantId: T, companyId, customerId } } });

const overrideAudits = () =>
  db.auditLog.findMany({ where: { action: "CustomerCreditModeOverridden" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

let otherCustomerId: string;

beforeEach(async () => {
  auditControl.fail = false;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.company.createMany({
    data: [
      { id: COMPANY_1, tenantId: T, name: "Company One", code: "C1", currency: "INR" },
      { id: COMPANY_2, tenantId: T, name: "Company Two", code: "C2", currency: "INR" },
    ],
  });
  await db.store.update({ where: { id: IDS.storeA }, data: { companyId: COMPANY_1 } });
  await db.store.create({
    data: { id: STORE_2, tenantId: T, name: "Store Two", code: "S2", currency: "INR", addressLine: "2 St", city: "Pune", state: "MH", companyId: COMPANY_2 },
  });
  otherCustomerId = (await db.customer.create({ data: { tenantId: T, name: "Other Customer", phone: "+919811100002" } })).id;
});

afterAll(async () => {
  await resetDatabase();
});

describe("authorization", () => {
  it("an OWNER can set and read an override", async () => {
    const res = await set("UNLIMITED", null);
    expect(res).toMatchObject({ status: "ok", changed: true, view: { mode: "UNLIMITED", limitMinor: null, source: "OWNER_OVERRIDE", accountExists: true } });
    const read = await getCustomerCreditMode({ actor: owner, customerId: COMMERCE_IDS.customerA });
    expect(read).toMatchObject({ status: "ok", view: { mode: "UNLIMITED", source: "OWNER_OVERRIDE" } });
  });

  it("STAFF can neither read nor change it, and nothing is written", async () => {
    expect(await set("UNLIMITED", null, { actor: staff })).toEqual({ status: "forbidden" });
    expect(await getCustomerCreditMode({ actor: staff, customerId: COMMERCE_IDS.customerA })).toEqual({ status: "forbidden" });
    expect(await db.customerCreditAccount.count()).toBe(0);
    expect(await overrideAudits()).toHaveLength(0);
  });
});

describe("mode and limit validation", () => {
  it.each([
    ["BLOCKED", null],
    ["UNLIMITED", null],
    ["LIMITED", 1],
    ["LIMITED", 2_147_483_647],
  ] as const)("accepts %s with limit %s", async (mode, limit) => {
    const res = await set(mode, limit);
    expect(res).toMatchObject({ status: "ok", view: { mode, limitMinor: limit } });
    expect(await accountOf(COMMERCE_IDS.customerA)).toMatchObject({ creditMode: mode, creditModeLimitMinor: limit, creditModeSource: "OWNER_OVERRIDE" });
  });

  it.each([
    ["LIMITED", null],
    ["LIMITED", 0],
    ["LIMITED", -5],
    ["LIMITED", 12.5],
    ["LIMITED", 2_147_483_648],
    ["UNLIMITED", 100],
    ["BLOCKED", 100],
    ["SOMETIMES", null],
  ])("refuses %s with limit %s and writes nothing", async (mode, limit) => {
    const res = await set(mode, limit);
    expect(res.status).toBe("validation_error");
    expect(await db.customerCreditAccount.count()).toBe(0);
    expect(await overrideAudits()).toHaveLength(0);
  });
});

describe("inheritance and isolation", () => {
  it("reading never creates an account and shows the company default that would be inherited", async () => {
    await db.company.update({ where: { id: COMPANY_1 }, data: { defaultCreditMode: "LIMITED", defaultCreditLimitMinor: 50_000 } });
    const read = await getCustomerCreditMode({ actor: owner, customerId: COMMERCE_IDS.customerA });
    expect(read).toMatchObject({
      status: "ok",
      view: { accountExists: false, mode: "BLOCKED", source: null, companyDefault: { mode: "LIMITED", limitMinor: 50_000 } },
    });
    expect(await db.customerCreditAccount.count()).toBe(0);
  });

  it("a missing account first inherits the company default; the audit records that inherited before-value", async () => {
    await db.company.update({ where: { id: COMPANY_1 }, data: { defaultCreditMode: "LIMITED", defaultCreditLimitMinor: 50_000 } });
    await set("UNLIMITED", null);
    const [audit] = await overrideAudits();
    expect(audit).toMatchObject({ tenantId: T, userId: IDS.ownerA });
    expect(audit!.metadata).toMatchObject({
      customerId: COMMERCE_IDS.customerA,
      companyId: COMPANY_1,
      before: { mode: "LIMITED", limitMinor: 50_000, source: "COMPANY_DEFAULT" },
      after: { mode: "UNLIMITED", limitMinor: null, source: "OWNER_OVERRIDE" },
    });
  });

  it("overriding one customer changes neither the company default nor another customer's account", async () => {
    await db.company.update({ where: { id: COMPANY_1 }, data: { defaultCreditMode: "UNLIMITED" } });
    await db.$transaction((tx) => findOrCreateCreditAccount(tx, { tenantId: T, companyId: COMPANY_1, customerId: otherCustomerId }));

    await set("BLOCKED", null);

    expect(await db.company.findUniqueOrThrow({ where: { id: COMPANY_1 } })).toMatchObject({ defaultCreditMode: "UNLIMITED", defaultCreditLimitMinor: null });
    expect(await accountOf(otherCustomerId)).toMatchObject({ creditMode: "UNLIMITED", creditModeSource: "COMPANY_DEFAULT" });
    expect(await accountOf(COMMERCE_IDS.customerA)).toMatchObject({ creditMode: "BLOCKED", creditModeSource: "OWNER_OVERRIDE" });
  });

  it("later company default changes do not touch an overridden account", async () => {
    await set("LIMITED", 75_000);
    await db.company.update({ where: { id: COMPANY_1 }, data: { defaultCreditMode: "UNLIMITED" } });
    expect(await accountOf(COMMERCE_IDS.customerA)).toMatchObject({ creditMode: "LIMITED", creditModeLimitMinor: 75_000, creditModeSource: "OWNER_OVERRIDE" });
  });

  it("the Store's company decides which account is changed; the other company's account is untouched", async () => {
    await set("UNLIMITED", null);
    await set("LIMITED", 10_000, { actor: { ...owner, storeId: STORE_2 } });
    expect(await accountOf(COMMERCE_IDS.customerA, COMPANY_1)).toMatchObject({ creditMode: "UNLIMITED" });
    expect(await accountOf(COMMERCE_IDS.customerA, COMPANY_2)).toMatchObject({ creditMode: "LIMITED", creditModeLimitMinor: 10_000 });
  });

  it("another tenant's customer is not found and gets no account", async () => {
    expect(await set("UNLIMITED", null, { customerId: COMMERCE_IDS.customerB })).toEqual({ status: "not_found" });
    expect(await getCustomerCreditMode({ actor: owner, customerId: COMMERCE_IDS.customerB })).toEqual({ status: "not_found" });
    expect(await db.customerCreditAccount.count()).toBe(0);
  });

  it("a store of another tenant, or an unmapped store, yields no company and no write", async () => {
    expect(await set("UNLIMITED", null, { actor: { ...owner, storeId: IDS.storeB } })).toEqual({ status: "company_unavailable" });
    await db.store.update({ where: { id: IDS.storeA }, data: { companyId: null } });
    expect(await set("UNLIMITED", null)).toEqual({ status: "company_unavailable" });
    expect(await db.customerCreditAccount.count()).toBe(0);
  });

  it("the legacy tenant-wide customer limit is not used as an override source", async () => {
    await db.customer.update({ where: { id: COMMERCE_IDS.customerA }, data: { creditLimitMinor: 999_999 } });
    const read = await getCustomerCreditMode({ actor: owner, customerId: COMMERCE_IDS.customerA });
    expect(read).toMatchObject({ status: "ok", view: { mode: "BLOCKED", limitMinor: null } });
  });
});

describe("audit and atomicity", () => {
  it("writes one audit row per real change and none for a repeat", async () => {
    await set("UNLIMITED", null);
    const repeat = await set("UNLIMITED", null);
    expect(repeat).toMatchObject({ status: "ok", changed: false });
    expect(await overrideAudits()).toHaveLength(1);
  });

  it("if the audit write fails, the account change and the inherited account roll back too", async () => {
    auditControl.fail = true;
    await expect(set("UNLIMITED", null)).rejects.toThrow("audit write failed");
    expect(await db.customerCreditAccount.count()).toBe(0);
    expect(await overrideAudits()).toHaveLength(0);
  });

  it("concurrent overrides serialise on the row lock without losing an update", async () => {
    await set("BLOCKED", null);
    await Promise.all([set("UNLIMITED", null), set("LIMITED", 20_000)]);
    const audits = await overrideAudits();
    expect(audits).toHaveLength(3);
    type Meta = { before: { mode: string }; after: { mode: string } };
    const second = audits[1]!.metadata as Meta;
    const third = audits[2]!.metadata as Meta;
    // The later change saw the earlier one's result as its before-value.
    expect(third.before.mode).toBe(second.after.mode);
    expect((await accountOf(COMMERCE_IDS.customerA))!.creditMode).toBe(third.after.mode);
  });
});
