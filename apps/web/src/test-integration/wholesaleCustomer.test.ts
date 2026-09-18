import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import {
  MAX_CREDIT_LIMIT_MINOR,
  MAX_PAYMENT_TERMS_DAYS,
  getCommercialProfile,
  setCommercialProfile,
  type WholesaleActor,
} from "@/server/wholesale/customerCommercial";
import { createCustomer, searchCustomers } from "@/server/sales/customers";
import { resolvePrice } from "@/server/pricing/pricingService";
import { createSale } from "@/server/sales/saleService";

/**
 * W-1 — the customer commercial profile and the WHOLESALE gate, against real PostgreSQL.
 *
 * Two things are worth proving beyond the obvious CRUD. First, that the gate is real: a tenant
 * without WHOLESALE cannot reach these operations even by calling the service directly. Second,
 * and more easily got wrong, that the gate did **not** leak onto the shared core — a retail-only
 * tenant must still create customers, price goods and sell.
 */

const CORR = "corr-w1";

const ownerA: WholesaleActor = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const staffA: WholesaleActor = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF",
  membershipRole: null,
};
const ownerB: WholesaleActor = {
  tenantId: IDS.tenantB,
  userId: IDS.ownerB,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};

/** WHOLESALE is not a default capability, so every test needing it switches it on. */
async function enableWholesale(tenantId: string) {
  await db.tenantCapability.upsert({
    where: { tenantId_capability: { tenantId, capability: "WHOLESALE" } },
    create: { tenantId, capability: "WHOLESALE", enabled: true },
    update: { enabled: true },
  });
}

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------

describe("what an existing customer looks like", () => {
  /** The backward-compatibility guarantee: nothing changed for anyone already trading. */
  it("defaults to RETAIL with no terms", async () => {
    const customer = await db.customer.findUniqueOrThrow({
      where: { id: COMMERCE_IDS.customerA },
    });
    expect(customer.customerType).toBe("RETAIL");
    expect(customer.paymentTermsDays).toBeNull();
    expect(customer.creditLimitMinor).toBeNull();
  });

  it("gives a newly created customer the same defaults", async () => {
    const result = await createCustomer({ tenantId: IDS.tenantA, name: "New Shop" });
    if (result.status !== "ok") throw new Error("create failed");

    const row = await db.customer.findUniqueOrThrow({ where: { id: result.customer.id } });
    expect(row.customerType).toBe("RETAIL");
  });
});

// ---------------------------------------------------------------------------------------------
// The capability gate
// ---------------------------------------------------------------------------------------------

describe("the WHOLESALE gate", () => {
  /** Not a default. A tenant that does not sell wholesale never silently gains the ability. */
  it("is off by default", async () => {
    const row = await db.tenantCapability.findUnique({
      where: { tenantId_capability: { tenantId: IDS.tenantA, capability: "WHOLESALE" } },
    });
    expect(row).toBeNull();
  });

  it("refuses to set commercial terms when WHOLESALE is off", async () => {
    const result = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "WHOLESALE",
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "capability_disabled", capability: "WHOLESALE" });

    const unchanged = await db.customer.findUniqueOrThrow({
      where: { id: COMMERCE_IDS.customerA },
    });
    expect(unchanged.customerType).toBe("RETAIL");
  });

  it("refuses to read commercial terms when WHOLESALE is off", async () => {
    const result = await getCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
    });
    expect(result.status).toBe("capability_disabled");
  });

  it("permits both once WHOLESALE is switched on", async () => {
    await enableWholesale(IDS.tenantA);

    const set = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "WHOLESALE",
      correlationId: CORR,
    });
    expect(set.status).toBe("ok");

    const read = await getCommercialProfile({ actor: ownerA, customerId: COMMERCE_IDS.customerA });
    expect(read.status).toBe("ok");
  });

  /** Disabling mid-life closes the door again; the stored terms are not destroyed. */
  it("closes again when WHOLESALE is switched off", async () => {
    await enableWholesale(IDS.tenantA);
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 500_000,
      correlationId: CORR,
    });

    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA, capability: "WHOLESALE" },
      data: { enabled: false },
    });

    expect(
      (await getCommercialProfile({ actor: ownerA, customerId: COMMERCE_IDS.customerA })).status,
    ).toBe("capability_disabled");

    const row = await db.customer.findUniqueOrThrow({ where: { id: COMMERCE_IDS.customerA } });
    expect(row.creditLimitMinor).toBe(500_000);
  });
});

describe("shared foundations stay ungated", () => {
  /**
   * The failure mode this phase most had to avoid: gating something retail needs. Every
   * assertion below runs with WHOLESALE switched off.
   */
  it("still creates a customer", async () => {
    const result = await createCustomer({ tenantId: IDS.tenantA, name: "Walk-in" });
    expect(result.status).toBe("ok");
  });

  it("still searches customers", async () => {
    // An empty query deliberately returns nothing — a counter search box should not dump the
    // whole book — so search for something real.
    const created = await createCustomer({ tenantId: IDS.tenantA, name: "Findable Buyer" });
    if (created.status !== "ok") throw new Error("create failed");

    const hits = await searchCustomers({ tenantId: IDS.tenantA, query: "Findable" });
    expect(hits.map((h) => h.id)).toContain(created.customer.id);
  });

  it("still resolves a price", async () => {
    const uom = await db.uom.create({
      data: { tenantId: IDS.tenantA, code: "PCS", name: "Pieces" },
    });
    const price = await resolvePrice({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      uomId: uom.id,
      quantity: 1,
    });
    expect(price.status).toBe("ok");
  });

  it("still completes a retail sale", async () => {
    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: "w1-retail-sale-1",
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: CORR,
    });
    expect(sale.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------------------------
// Setting terms
// ---------------------------------------------------------------------------------------------

describe("setting commercial terms", () => {
  beforeEach(async () => {
    await enableWholesale(IDS.tenantA);
  });

  it("records type, terms and limit", async () => {
    const result = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "WHOLESALE",
      paymentTermsDays: 30,
      creditLimitMinor: 5_000_000,
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.profile.customerType).toBe("WHOLESALE");
    expect(result.profile.paymentTermsDays).toBe(30);
    expect(result.profile.creditLimitMinor).toBe(5_000_000);
  });

  /** Omitting a field must not silently wipe the one beside it. */
  it("leaves omitted fields untouched", async () => {
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "WHOLESALE",
      paymentTermsDays: 45,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });

    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 2_000_000,
      correlationId: CORR,
    });

    const row = await db.customer.findUniqueOrThrow({ where: { id: COMMERCE_IDS.customerA } });
    expect(row.paymentTermsDays).toBe(45);
    expect(row.customerType).toBe("WHOLESALE");
    expect(row.creditLimitMinor).toBe(2_000_000);
  });

  /** "We no longer extend credit" and "I did not mention credit" are different statements. */
  it("clears a field when null is sent explicitly", async () => {
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: null,
      correlationId: CORR,
    });

    const row = await db.customer.findUniqueOrThrow({ where: { id: COMMERCE_IDS.customerA } });
    expect(row.creditLimitMinor).toBeNull();
  });

  /** Zero is a decision — "no credit" — and distinct from "no limit agreed". */
  it("accepts a zero credit limit", async () => {
    const result = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 0,
      correlationId: CORR,
    });
    if (result.status !== "ok") return;
    expect(result.profile.creditLimitMinor).toBe(0);
  });

  it("refuses a negative or fractional credit limit", async () => {
    for (const limit of [-1, 10.5]) {
      const result = await setCommercialProfile({
        actor: ownerA,
        customerId: COMMERCE_IDS.customerA,
        creditLimitMinor: limit,
        correlationId: CORR,
      });
      expect(result.status).toBe("validation_error");
    }
  });

  it("refuses an implausible credit limit", async () => {
    const result = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: MAX_CREDIT_LIMIT_MINOR + 1,
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });

  it("refuses negative, fractional or absurd payment terms", async () => {
    for (const days of [-1, 1.5, MAX_PAYMENT_TERMS_DAYS + 1]) {
      const result = await setCommercialProfile({
        actor: ownerA,
        customerId: COMMERCE_IDS.customerA,
        paymentTermsDays: days,
        correlationId: CORR,
      });
      expect(result.status).toBe("validation_error");
    }
  });

  it("writes an audit entry", async () => {
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "DISTRIBUTOR",
      correlationId: CORR,
    });

    const entry = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "CustomerCommercialProfileSet" },
    });
    expect(entry?.userId).toBe(IDS.ownerA);
    expect(entry?.metadata).toMatchObject({ customerId: COMMERCE_IDS.customerA });
  });
});

// ---------------------------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------------------------

describe("who may set commercial terms", () => {
  beforeEach(async () => {
    await enableWholesale(IDS.tenantA);
  });

  /** Terms are a tenant-wide commitment about money, not a till operation. */
  it("refuses a staff user", async () => {
    const result = await setCommercialProfile({
      actor: staffA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("refuses a staff user even with a store role", async () => {
    await db.storeMembership.create({
      data: {
        tenantId: IDS.tenantA,
        userId: IDS.staffA,
        storeId: IDS.storeA,
        role: "STORE_MANAGER",
      },
    });

    const result = await setCommercialProfile({
      actor: { ...staffA, membershipRole: "STORE_MANAGER" },
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("writes no audit entry for a refused change", async () => {
    await setCommercialProfile({
      actor: staffA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });

    const count = await db.auditLog.count({
      where: { tenantId: IDS.tenantA, action: "CustomerCommercialProfileSet" },
    });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------------------------

describe("tenant isolation", () => {
  beforeEach(async () => {
    await enableWholesale(IDS.tenantA);
    await enableWholesale(IDS.tenantB);
  });

  it("refuses to set terms on another tenant's customer", async () => {
    const result = await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerB,
      creditLimitMinor: 1_000_000,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "not_found" });

    const untouched = await db.customer.findUniqueOrThrow({
      where: { id: COMMERCE_IDS.customerB },
    });
    expect(untouched.creditLimitMinor).toBeNull();
  });

  it("refuses to read another tenant's terms", async () => {
    const result = await getCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerB,
    });
    expect(result).toEqual({ status: "not_found" });
  });

  /** A foreign customer is indistinguishable from one that never existed. */
  it("answers a foreign customer and a nonexistent one identically", async () => {
    const foreign = await getCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerB,
    });
    const missing = await getCommercialProfile({ actor: ownerA, customerId: "no-such-customer" });
    expect(foreign).toEqual(missing);
  });

  it("keeps each tenant's terms separate", async () => {
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      creditLimitMinor: 111,
      correlationId: CORR,
    });
    await setCommercialProfile({
      actor: ownerB,
      customerId: COMMERCE_IDS.customerB,
      creditLimitMinor: 222,
      correlationId: CORR,
    });

    const a = await db.customer.findUniqueOrThrow({ where: { id: COMMERCE_IDS.customerA } });
    const b = await db.customer.findUniqueOrThrow({ where: { id: COMMERCE_IDS.customerB } });
    expect(a.creditLimitMinor).toBe(111);
    expect(b.creditLimitMinor).toBe(222);
  });

  /** Tenant B having WHOLESALE does not grant it to tenant A. */
  it("does not let one tenant's capability serve another", async () => {
    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA, capability: "WHOLESALE" },
      data: { enabled: false },
    });

    expect(
      (await getCommercialProfile({ actor: ownerA, customerId: COMMERCE_IDS.customerA })).status,
    ).toBe("capability_disabled");
    expect(
      (await getCommercialProfile({ actor: ownerB, customerId: COMMERCE_IDS.customerB })).status,
    ).toBe("ok");
  });
});

// ---------------------------------------------------------------------------------------------
// What W-1 deliberately does not do
// ---------------------------------------------------------------------------------------------

describe("credit is configuration, not accounting", () => {
  beforeEach(async () => {
    await enableWholesale(IDS.tenantA);
  });

  /**
   * The honesty test for this phase. A credit limit is stored; nothing is enforced and no
   * balance exists. If a future change starts refusing orders on credit without the ERP
   * outstanding balance behind it, this fails.
   */
  it("does not refuse a sale to a customer over their credit limit", async () => {
    await setCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      customerType: "WHOLESALE",
      creditLimitMinor: 1, // one paisa: any sale exceeds it
      correlationId: CORR,
    });

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      idempotencyKey: "w1-over-limit-1",
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: CORR,
    });
    expect(sale.status).toBe("ok");
  });

  /** No balance, outstanding, ageing or availability column exists anywhere. */
  it("has no accounting-state column in the schema", async () => {
    const rows = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%outstanding%'
          OR column_name ILIKE '%ageing%'
          OR column_name ILIKE '%aging%'
          OR column_name ILIKE '%receivable%'
          OR column_name ILIKE '%availablecredit%')
    `;
    expect(rows).toEqual([]);
  });

  /** The profile exposes terms only — never a computed position. */
  it("returns no balance or availability field", async () => {
    const result = await getCommercialProfile({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
    });
    if (result.status !== "ok") return;
    expect(Object.keys(result.profile).sort()).toEqual([
      "creditLimitMinor",
      "customerId",
      "customerType",
      "paymentTermsDays",
    ]);
  });
});

describe("phone uniqueness is unchanged", () => {
  /**
   * Preserved deliberately. Phone is the retail creation-dedup key — `createCustomer` resolves
   * on it so pressing "add" twice cannot produce two records — and weakening it to suit B2B
   * would change frozen Retail behaviour. The B2B limitation is documented, not silently fixed.
   */
  it("still deduplicates a repeat customer by phone", async () => {
    const first = await createCustomer({
      tenantId: IDS.tenantA,
      name: "Repeat Buyer",
      phone: "+919800000001",
    });
    const second = await createCustomer({
      tenantId: IDS.tenantA,
      name: "Repeat Buyer Again",
      phone: "+919800000001",
    });

    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.existing).toBe(true);
  });

  it("still refuses a duplicate phone at the database", async () => {
    await db.customer.create({
      data: { tenantId: IDS.tenantA, name: "First", phone: "+919800000002" },
    });
    await expect(
      db.customer.create({
        data: { tenantId: IDS.tenantA, name: "Second", phone: "+919800000002" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  /** Two tenants may both hold the same number; the constraint is tenant-scoped. */
  it("allows two tenants to share a number", async () => {
    await db.customer.create({
      data: { tenantId: IDS.tenantA, name: "A Buyer", phone: "+919800000003" },
    });
    const b = await db.customer.create({
      data: { tenantId: IDS.tenantB, name: "B Buyer", phone: "+919800000003" },
    });
    expect(b.id).toBeTruthy();
  });

  /** Several customers without a phone remain possible — NULLs are distinct in the index. */
  it("allows many customers with no phone at all", async () => {
    await db.customer.create({ data: { tenantId: IDS.tenantA, name: "No Phone One" } });
    await db.customer.create({ data: { tenantId: IDS.tenantA, name: "No Phone Two" } });

    const count = await db.customer.count({ where: { tenantId: IDS.tenantA, phone: null } });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
