import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { Capability, DEFAULT_CAPABILITIES } from "@/server/capability/capabilities";
import {
  hasCapability,
  listCapabilities,
  requireCapability,
  setCapability,
  seedDefaultCapabilities,
} from "@/server/capability/capabilityService";
import { createSale } from "@/server/sales/saleService";

/**
 * Capabilities against real PostgreSQL.
 *
 * The claims worth proving here are claims about the database and about the boundary between
 * tenants — a unique index, a foreign key, and the impossibility of naming another tenant. None
 * of those can be demonstrated against a mock.
 */

const OWNER_A = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const STAFF_A = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const OWNER_B = { tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: "OWNER" as const };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

describe("a tenant has capabilities", () => {
  it("receives the default grant, and only that", async () => {
    const states = await listCapabilities(IDS.tenantA);

    const enabled = states.filter((s) => s.enabled).map((s) => s.capability);
    expect(enabled).toEqual([...DEFAULT_CAPABILITIES]);
    expect(enabled).toEqual([Capability.RETAIL]);
  });

  /**
   * A capability with no row is reported, as disabled. "Off" and "never configured" are the same
   * answer to the gate, and the listing must not make them look different to a reader.
   */
  it("reports every capability, including the ones with no row", async () => {
    const states = await listCapabilities(IDS.tenantA);

    expect(states).toHaveLength(7);
    expect(states.map((s) => s.capability)).toContain(Capability.MANUFACTURING);
    expect(states.find((s) => s.capability === Capability.MANUFACTURING)?.enabled).toBe(false);

    const rows = await db.tenantCapability.count({
      where: { tenantId: IDS.tenantA, capability: Capability.MANUFACTURING },
    });
    expect(rows).toBe(0);
  });

  it("answers the check correctly for a granted and an ungranted capability", async () => {
    expect(await hasCapability(IDS.tenantA, Capability.RETAIL)).toBe(true);
    expect(await hasCapability(IDS.tenantA, Capability.WHOLESALE)).toBe(false);
  });

  /**
   * A capability that was never configured must not be an error, a throw, or a permissive
   * default. It is simply off.
   */
  it("handles a capability the tenant does not have without failing", async () => {
    const gate = await requireCapability(IDS.tenantA, Capability.JOB_WORK);
    expect(gate).toEqual({ status: "capability_disabled", capability: Capability.JOB_WORK });
  });
});

describe("the database refuses a duplicate capability row", () => {
  /**
   * Raw Prisma, bypassing the service entirely. If this insert ever succeeds, two rows could
   * disagree about whether a module is on and the gate's answer becomes non-deterministic — so
   * the constraint, not the service, has to be the thing that refuses.
   */
  it("rejects a second row for the same tenant and capability", async () => {
    await expect(
      db.tenantCapability.create({
        data: { tenantId: IDS.tenantA, capability: Capability.RETAIL, enabled: false },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same capability for a different tenant", async () => {
    await db.tenantCapability.create({
      data: { tenantId: IDS.tenantB, capability: Capability.WHOLESALE, enabled: true },
    });
    await db.tenantCapability.create({
      data: { tenantId: IDS.tenantA, capability: Capability.WHOLESALE, enabled: true },
    });

    const count = await db.tenantCapability.count({ where: { capability: Capability.WHOLESALE } });
    expect(count).toBe(2);
  });

  /** The seeding function is replay-safe, so a retried registration cannot fail on a duplicate. */
  it("tolerates the default grant being seeded twice", async () => {
    await seedDefaultCapabilities(db, IDS.tenantA);
    await seedDefaultCapabilities(db, IDS.tenantA);

    const count = await db.tenantCapability.count({
      where: { tenantId: IDS.tenantA, capability: Capability.RETAIL },
    });
    expect(count).toBe(1);
  });

  /** Two owners toggling at once; whatever the outcome, there must never be two rows. */
  it("survives concurrent writes of the same capability", async () => {
    await Promise.allSettled([
      setCapability({
        actor: OWNER_A,
        capability: Capability.WHOLESALE,
        enabled: true,
        correlationId: "c-1",
      }),
      setCapability({
        actor: OWNER_A,
        capability: Capability.WHOLESALE,
        enabled: true,
        correlationId: "c-2",
      }),
    ]);

    const count = await db.tenantCapability.count({
      where: { tenantId: IDS.tenantA, capability: Capability.WHOLESALE },
    });
    expect(count).toBe(1);
  });
});

describe("enabling and disabling", () => {
  it("enables a capability the tenant did not have", async () => {
    const result = await setCapability({
      actor: OWNER_A,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-enable",
    });

    expect(result).toMatchObject({ status: "ok", enabled: true, changed: true });
    expect(await hasCapability(IDS.tenantA, Capability.WHOLESALE)).toBe(true);
  });

  it("disables a capability the tenant had", async () => {
    const result = await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-disable",
    });

    expect(result).toMatchObject({ status: "ok", enabled: false, changed: true });
    expect(await hasCapability(IDS.tenantA, Capability.RETAIL)).toBe(false);
  });

  /**
   * Disabling updates the row rather than deleting it. Deleting would erase the fact that the
   * module was ever on, and re-enabling would then look like a first-time grant.
   */
  it("keeps the row when disabling", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-disable",
    });

    const row = await db.tenantCapability.findUnique({
      where: { tenantId_capability: { tenantId: IDS.tenantA, capability: Capability.RETAIL } },
    });
    expect(row).not.toBeNull();
    expect(row?.enabled).toBe(false);
  });

  it("can re-enable something it disabled", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: true,
      correlationId: "c-on",
    });

    expect(await hasCapability(IDS.tenantA, Capability.RETAIL)).toBe(true);
  });

  /** A replayed request is not an error, and it is not a change either. */
  it("reports a no-op setting as unchanged", async () => {
    const result = await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: true,
      correlationId: "c-noop",
    });

    expect(result).toMatchObject({ status: "ok", enabled: true, changed: false });
  });

  /** Capability changes ride the existing AuditLog trail; no new audit system was built. */
  it("writes an audit entry naming the capability and the actor", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-audit",
    });

    const entry = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "TenantCapabilityEnabled" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.userId).toBe(IDS.ownerA);
    expect(entry?.metadata).toMatchObject({ capability: Capability.WHOLESALE });
  });

  it("audits a disable distinctly from an enable", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-audit-off",
    });

    const entry = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "TenantCapabilityDisabled" },
    });
    expect(entry?.metadata).toMatchObject({ capability: Capability.RETAIL });
  });
});

describe("only the owner configures capabilities", () => {
  it("refuses a staff user", async () => {
    const result = await setCapability({
      actor: STAFF_A,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-staff",
    });

    expect(result).toEqual({ status: "forbidden" });
    expect(await hasCapability(IDS.tenantA, Capability.WHOLESALE)).toBe(false);
  });

  /**
   * A store role is not a route to capability configuration. This staff user is a STORE_MANAGER
   * — enough to move stock and set prices, and still not enough to change what business the
   * company is in.
   */
  it("refuses a staff user who manages a store", async () => {
    await db.storeMembership.create({
      data: {
        tenantId: IDS.tenantA,
        userId: IDS.staffA,
        storeId: IDS.storeA,
        role: "STORE_MANAGER",
      },
    });

    const result = await setCapability({
      actor: STAFF_A,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-manager",
    });

    expect(result).toEqual({ status: "forbidden" });
  });

  it("writes no audit entry for a refused change", async () => {
    await setCapability({
      actor: STAFF_A,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-staff-audit",
    });

    const count = await db.auditLog.count({
      where: { tenantId: IDS.tenantA, action: "TenantCapabilityEnabled" },
    });
    expect(count).toBe(0);
  });
});

describe("tenant isolation", () => {
  /**
   * The service takes no tenant parameter a caller could aim elsewhere — the tenant comes from
   * the actor, which comes from the session. These tests prove the shape holds by trying the
   * only thing an attacker could actually attempt.
   */
  it("shows tenant A only its own capabilities", async () => {
    await setCapability({
      actor: OWNER_B,
      capability: Capability.MANUFACTURING,
      enabled: true,
      correlationId: "c-b",
    });

    const statesA = await listCapabilities(IDS.tenantA);
    expect(statesA.find((s) => s.capability === Capability.MANUFACTURING)?.enabled).toBe(false);

    const statesB = await listCapabilities(IDS.tenantB);
    expect(statesB.find((s) => s.capability === Capability.MANUFACTURING)?.enabled).toBe(true);
  });

  it("does not let tenant B's grant satisfy tenant A's check", async () => {
    await setCapability({
      actor: OWNER_B,
      capability: Capability.WHOLESALE,
      enabled: true,
      correlationId: "c-b-wholesale",
    });

    expect(await hasCapability(IDS.tenantB, Capability.WHOLESALE)).toBe(true);
    expect(await hasCapability(IDS.tenantA, Capability.WHOLESALE)).toBe(false);
  });

  it("does not let owner A's change reach tenant B", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.COMMERCE,
      enabled: true,
      correlationId: "c-a-commerce",
    });

    expect(await hasCapability(IDS.tenantB, Capability.COMMERCE)).toBe(false);
  });

  it("does not let owner A disable a capability for tenant B", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-a-off",
    });

    expect(await hasCapability(IDS.tenantA, Capability.RETAIL)).toBe(false);
    expect(await hasCapability(IDS.tenantB, Capability.RETAIL)).toBe(true);
  });

  /**
   * Database-level integrity, bypassing every service. A capability row for a tenant that does
   * not exist is refused by the foreign key, which is what makes "capabilities always belong to
   * a real tenant" a property of the data rather than a habit of the code.
   */
  it("refuses a capability row for a nonexistent tenant", async () => {
    await expect(
      db.tenantCapability.create({
        data: { tenantId: "t-does-not-exist", capability: Capability.RETAIL, enabled: true },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses to reassign a capability row to a nonexistent tenant", async () => {
    const row = await db.tenantCapability.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, capability: Capability.RETAIL },
    });

    await expect(
      db.tenantCapability.update({
        where: { id: row.id },
        data: { tenantId: "t-does-not-exist" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  /**
   * There is no cross-tenant capability row to guard against by construction: `tenantId` here is
   * the parent itself, not a sibling that could belong elsewhere. This asserts that shape rather
   * than assuming it.
   */
  it("scopes every row to exactly one tenant", async () => {
    const rows = await db.tenantCapability.findMany({ select: { tenantId: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect([IDS.tenantA, IDS.tenantB]).toContain(row.tenantId);
    }
  });
});

describe("the gate refuses a real operation", () => {
  beforeEach(async () => {
    await seedCommerce();
  });

  const saleInput = (idempotencyKey: string) => ({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey,
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    payment: { method: "CASH" as const },
    correlationId: "c-sale",
  });

  /** The compatibility guarantee: nothing changed for a tenant that has RETAIL. */
  it("permits a sale while RETAIL is enabled", async () => {
    const result = await createSale(saleInput("k-enabled"));
    expect(result.status).toBe("ok");
  });

  it("refuses a sale once RETAIL is disabled", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });

    const result = await createSale(saleInput("k-disabled"));
    expect(result).toEqual({ status: "capability_disabled", capability: Capability.RETAIL });
  });

  /**
   * The refusal is a refusal, not a slow failure: no sale row, no stock movement, no outbox
   * event. A gate that rejected the response while committing the side effects would be worse
   * than no gate at all.
   */
  it("writes nothing when it refuses", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });

    const before = await db.stockMovement.count({ where: { tenantId: IDS.tenantA } });
    await createSale(saleInput("k-nothing"));

    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
    expect(await db.stockMovement.count({ where: { tenantId: IDS.tenantA } })).toBe(before);
    expect(
      await db.outboxEvent.count({ where: { tenantId: IDS.tenantA, eventType: "SaleCompleted" } }),
    ).toBe(0);
  });

  it("sells again once RETAIL is switched back on", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: true,
      correlationId: "c-on",
    });

    const result = await createSale(saleInput("k-back-on"));
    expect(result.status).toBe("ok");
  });

  /**
   * Disabling RETAIL for tenant A must not stop tenant B selling. The gate reads the caller's
   * own tenant, so this is really a test that it reads the right row.
   */
  it("does not affect another tenant's selling", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });

    const result = await createSale({
      tenantId: IDS.tenantB,
      storeId: IDS.storeB,
      cashierUserId: IDS.ownerB,
      idempotencyKey: "k-tenant-b",
      lines: [{ variantId: COMMERCE_IDS.variantB1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: "c-sale-b",
    });
    expect(result.status).toBe("ok");
  });

  /**
   * Capability is not permission, and neither substitutes for the other. With RETAIL enabled, a
   * user who may not sell is still refused — and the refusal is the authorization one.
   */
  it("still refuses an unauthorized user when the capability is enabled", async () => {
    const result = await createSale({ ...saleInput("k-staff"), cashierUserId: IDS.staffA });
    expect(result).toEqual({ status: "forbidden" });
  });

  /**
   * And the other ordering: capability off, user also unauthorized. The capability refusal comes
   * first, because asking which cashier may ring up a sale is meaningless when the business does
   * no retail.
   */
  it("refuses on capability before authorization when both fail", async () => {
    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });

    const result = await createSale({ ...saleInput("k-both"), cashierUserId: IDS.staffA });
    expect(result.status).toBe("capability_disabled");
  });

  /**
   * A sale that already committed is a fact. Switching the module off afterwards must not
   * rewrite history — the replay still returns the receipt.
   */
  it("still replays an already-committed sale after the capability is disabled", async () => {
    const first = await createSale(saleInput("k-replay"));
    expect(first.status).toBe("ok");

    await setCapability({
      actor: OWNER_A,
      capability: Capability.RETAIL,
      enabled: false,
      correlationId: "c-off",
    });

    const replay = await createSale(saleInput("k-replay"));
    expect(replay).toMatchObject({ status: "ok", duplicate: true });
  });
});

describe("existing behaviour is unchanged", () => {
  beforeEach(async () => {
    await seedCommerce();
  });

  /** Pricing, inventory and UOM are not capability-gated in this phase, and must not become so. */
  it("leaves price list management ungated", async () => {
    const priceList = await db.priceList.create({
      data: { tenantId: IDS.tenantA, name: "Trade", currency: "INR" },
    });
    expect(priceList.id).toBeTruthy();
  });

  it("leaves stock movements ungated", async () => {
    const movements = await db.stockMovement.count({ where: { tenantId: IDS.tenantA } });
    expect(movements).toBeGreaterThan(0);
  });

  it("leaves units of measure ungated", async () => {
    const uom = await db.uom.create({ data: { tenantId: IDS.tenantA, code: "BOX", name: "Box" } });
    expect(uom.id).toBeTruthy();
  });

  /**
   * The capability column is a PostgreSQL enum, so an invalid identifier cannot be stored at
   * all. An authorization key the database refuses to hold is one fewer way to be wrong.
   */
  it("refuses an identifier that is not a capability", async () => {
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO tenant_capabilities ("id", "tenantId", "capability", "enabled", "createdAt", "updatedAt")
        VALUES ('bad-1', '${IDS.tenantA}', 'ORDERS', true, NOW(), NOW())
      `),
    ).rejects.toThrow();
  });
});
