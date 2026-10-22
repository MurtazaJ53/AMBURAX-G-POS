import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { findOrCreateCreditAccount } from "@/server/khata/creditAccount";
import { writeAuditLogTx } from "@/server/identity/audit";

/**
 * Credit mode groundwork against real PostgreSQL: the CHECK constraints, the BLOCKED defaults,
 * inheritance of the Company default at account creation, and that later default changes leave
 * existing accounts alone. Nothing here touches checkout or payments.
 */

const T = IDS.tenantA;
const COMPANY = "co-credit-mode-aaaaaaaaaa1";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.company.create({ data: { id: COMPANY, tenantId: T, name: "Credit Co", code: "CC", currency: "INR" } });
});

afterAll(async () => {
  await resetDatabase();
});

const create = (customerId: string = COMMERCE_IDS.customerA) =>
  db.$transaction((tx) => findOrCreateCreditAccount(tx, { tenantId: T, companyId: COMPANY, customerId }));

describe("defaults", () => {
  it("a new Company defaults to BLOCKED with no limit", async () => {
    const company = await db.company.findUniqueOrThrow({ where: { id: COMPANY } });
    expect(company).toMatchObject({ defaultCreditMode: "BLOCKED", defaultCreditLimitMinor: null });
  });

  it("a legacy-shaped account row (no mode columns given) is BLOCKED and marked MIGRATED", async () => {
    // Same column list the pre-mode schema could write; the new columns take their defaults,
    // which is what the migration's explicit UPDATE also sets for existing rows.
    await db.$executeRaw`
      INSERT INTO "customer_credit_accounts" ("id","tenantId","companyId","customerId","currency","creditLimitMinor","creditEnabled","updatedAt")
      VALUES ('cca-legacy-1', ${T}, ${COMPANY}, ${COMMERCE_IDS.customerA}, 'INR', 50000, true, CURRENT_TIMESTAMP)`;
    const row = await db.customerCreditAccount.findUniqueOrThrow({ where: { id: "cca-legacy-1" } });
    expect(row).toMatchObject({ creditMode: "BLOCKED", creditModeLimitMinor: null, creditModeSource: "MIGRATED" });
    // The legacy limit and flag are untouched; they do not grant a mode.
    expect(row).toMatchObject({ creditLimitMinor: 50_000, creditEnabled: true });
  });
});

describe("mode and limit pairing is enforced by the database", () => {
  it.each([
    ["LIMITED without a limit", { defaultCreditMode: "LIMITED" as const, defaultCreditLimitMinor: null }],
    ["LIMITED with a zero limit", { defaultCreditMode: "LIMITED" as const, defaultCreditLimitMinor: 0 }],
    ["LIMITED with a negative limit", { defaultCreditMode: "LIMITED" as const, defaultCreditLimitMinor: -1 }],
    ["UNLIMITED with a limit", { defaultCreditMode: "UNLIMITED" as const, defaultCreditLimitMinor: 1000 }],
    ["BLOCKED with a limit", { defaultCreditMode: "BLOCKED" as const, defaultCreditLimitMinor: 1000 }],
  ])("refuses a Company default of %s", async (_label, data) => {
    await expect(db.company.update({ where: { id: COMPANY }, data })).rejects.toThrow(/chk_companies_default_credit_limit/);
  });

  it.each([
    ["LIMITED without a limit", { creditMode: "LIMITED" as const, creditModeLimitMinor: null }],
    ["LIMITED with a zero limit", { creditMode: "LIMITED" as const, creditModeLimitMinor: 0 }],
    ["UNLIMITED with a limit", { creditMode: "UNLIMITED" as const, creditModeLimitMinor: 1000 }],
    ["BLOCKED with a limit", { creditMode: "BLOCKED" as const, creditModeLimitMinor: 1000 }],
  ])("refuses an account mode of %s", async (_label, data) => {
    const account = await create();
    await expect(db.customerCreditAccount.update({ where: { id: account.id }, data })).rejects.toThrow(/chk_cca_credit_mode_limit/);
  });

  it("accepts the valid pairings", async () => {
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "UNLIMITED", defaultCreditLimitMinor: null } });
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "LIMITED", defaultCreditLimitMinor: 1 } });
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "BLOCKED", defaultCreditLimitMinor: null } });
  });
});

describe("inheritance at account creation", () => {
  it.each([
    ["BLOCKED", null],
    ["UNLIMITED", null],
    ["LIMITED", 250_000],
  ] as const)("copies a %s Company default", async (mode, limit) => {
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: mode, defaultCreditLimitMinor: limit } });
    const account = await create();
    expect(account).toMatchObject({
      tenantId: T,
      companyId: COMPANY,
      customerId: COMMERCE_IDS.customerA,
      currency: "INR",
      creditMode: mode,
      creditModeLimitMinor: limit,
      creditModeSource: "COMPANY_DEFAULT",
    });
  });

  it("returns the existing account rather than creating a second one", async () => {
    const first = await create();
    const second = await create();
    expect(second.id).toBe(first.id);
    expect(await db.customerCreditAccount.count()).toBe(1);
  });

  it("concurrent creators end with exactly one account", async () => {
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "UNLIMITED" } });
    const results = await Promise.all([create(), create(), create()]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.customerCreditAccount.count()).toBe(1);
  });

  it("refuses another tenant's customer", async () => {
    await expect(create(COMMERCE_IDS.customerB)).rejects.toThrow();
    expect(await db.customerCreditAccount.count()).toBe(0);
  });

  it("refuses a Company of another tenant", async () => {
    await expect(
      db.$transaction((tx) =>
        findOrCreateCreditAccount(tx, { tenantId: IDS.tenantB, companyId: COMPANY, customerId: COMMERCE_IDS.customerB }),
      ),
    ).rejects.toThrow("not found");
    expect(await db.customerCreditAccount.count()).toBe(0);
  });
});

describe("Company default changes are future-only", () => {
  it("changing the default leaves an existing account unchanged and applies to the next account", async () => {
    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "LIMITED", defaultCreditLimitMinor: 100_000 } });
    const before = await create();

    await db.company.update({ where: { id: COMPANY }, data: { defaultCreditMode: "UNLIMITED", defaultCreditLimitMinor: null } });

    const reread = await db.customerCreditAccount.findUniqueOrThrow({ where: { id: before.id } });
    expect(reread).toMatchObject({ creditMode: "LIMITED", creditModeLimitMinor: 100_000, creditModeSource: "COMPANY_DEFAULT" });
    expect(reread.creditModeSetAt).toEqual(before.creditModeSetAt);
    // Finding the account again does not re-inherit either.
    expect((await create()).creditMode).toBe("LIMITED");

    const other = await db.customer.create({ data: { tenantId: T, name: "Second Customer", phone: "+919811100001" } });
    expect(await create(other.id)).toMatchObject({ creditMode: "UNLIMITED", creditModeLimitMinor: null });
  });
});

describe("transaction-aware audit", () => {
  it("rolls the audit row back with the transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await writeAuditLogTx(tx, { tenantId: T, action: "credit.mode.rollback-test", correlationId: "corr-audit" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await db.auditLog.count({ where: { action: "credit.mode.rollback-test" } })).toBe(0);
  });

  it("commits the audit row with the transaction", async () => {
    await db.$transaction((tx) => writeAuditLogTx(tx, { tenantId: T, action: "credit.mode.commit-test", correlationId: "corr-audit" }));
    expect(await db.auditLog.count({ where: { action: "credit.mode.commit-test" } })).toBe(1);
  });
});
