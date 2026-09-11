import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db, resetDatabase, seedTwoTenants, IDS, FIXTURE_PASSWORD_HASH } from "./db";
import { canConfigurePos } from "@/server/pos/posRoles";

/**
 * Closes P1-2: these run against a REAL PostgreSQL, not mocked Prisma.
 *
 * The mocked suites in `src/test/` prove the application code reacts correctly when a
 * conditional claim loses. They cannot prove what this file proves: that PostgreSQL
 * actually enforces the unique constraints, that row locks actually serialize two
 * concurrent transactions, and that a rollback actually leaves nothing behind.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe("tenant isolation — reads", () => {
  it("a tenant-scoped store query never returns another tenant's store", async () => {
    // The exact shape storeSetup.ts / posDeviceSetup.ts use.
    const asA = await db.store.findFirst({
      where: { id: IDS.storeB, tenantId: IDS.tenantA },
    });
    expect(asA).toBeNull();

    const own = await db.store.findFirst({
      where: { id: IDS.storeA, tenantId: IDS.tenantA },
    });
    expect(own?.name).toBe("Store A");
  });

  it("listing by tenant returns only that tenant's rows", async () => {
    const storesA = await db.store.findMany({ where: { tenantId: IDS.tenantA } });
    const usersA = await db.user.findMany({ where: { tenantId: IDS.tenantA } });

    expect(storesA.map((s) => s.id)).toEqual([IDS.storeA]);
    expect(usersA.map((u) => u.id).sort()).toEqual([IDS.ownerA, IDS.staffA].sort());
    expect(usersA.some((u) => u.tenantId === IDS.tenantB)).toBe(false);
  });

  it("invitations are not visible across the tenant boundary", async () => {
    await db.invitation.create({
      data: {
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        email: "secret-hire@example.com",
        role: "CASHIER",
        inviterUserId: IDS.ownerB,
        tokenHash: "b".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const seenByA = await db.invitation.findMany({ where: { tenantId: IDS.tenantA } });
    expect(seenByA).toHaveLength(0);

    const all = await db.invitation.findMany();
    expect(all).toHaveLength(1); // it exists — it is simply invisible to A
  });

  it("readiness-style aggregate counts stay tenant-scoped", async () => {
    const membersA = await db.storeMembership.count({ where: { storeId: IDS.storeA } });
    const membersB = await db.storeMembership.count({ where: { storeId: IDS.storeB } });
    expect(membersA).toBe(1);
    expect(membersB).toBe(1);
  });
});

describe("tenant isolation — writes", () => {
  it("a tenant-scoped updateMany cannot modify another tenant's store", async () => {
    const result = await db.store.updateMany({
      where: { id: IDS.storeB, tenantId: IDS.tenantA },
      data: { name: "HIJACKED" },
    });

    expect(result.count).toBe(0);
    const storeB = await db.store.findUnique({ where: { id: IDS.storeB } });
    expect(storeB?.name).toBe("Store B");
  });

  it("a tenant-scoped onboarding claim cannot advance another tenant", async () => {
    const crossTenant = await db.tenant.updateMany({
      where: { id: IDS.tenantA, onboardingStep: "STORE_CREATED" },
      data: { onboardingStep: "COMPLETE" },
    });
    expect(crossTenant.count).toBe(1);

    // Tenant B was at the same step and must be untouched by A's claim.
    const b = await db.tenant.findUnique({ where: { id: IDS.tenantB } });
    expect(b?.onboardingStep).toBe("STORE_CREATED");
  });

  it("a tenant-scoped delete cannot remove another tenant's data", async () => {
    const deleted = await db.store.deleteMany({ where: { id: IDS.storeB, tenantId: IDS.tenantA } });
    expect(deleted.count).toBe(0);
    expect(await db.store.count()).toBe(2);
  });
});

describe("store authorization", () => {
  it("a staff user with no membership cannot configure a POS for that store", async () => {
    const membership = await db.storeMembership.findUnique({
      where: { userId_storeId: { userId: IDS.staffA, storeId: IDS.storeA } },
    });
    expect(membership).toBeNull();

    expect(
      canConfigurePos({
        tenantRole: "STAFF",
        storeBelongsToTenant: true,
        membershipRole: membership?.role ?? null,
      }),
    ).toBe(false);
  });

  it("a cashier membership does not grant POS configuration", async () => {
    await db.storeMembership.create({
      data: { userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const m = await db.storeMembership.findUnique({
      where: { userId_storeId: { userId: IDS.staffA, storeId: IDS.storeA } },
    });

    expect(
      canConfigurePos({ tenantRole: "STAFF", storeBelongsToTenant: true, membershipRole: m!.role }),
    ).toBe(false);
  });

  it("a store manager membership does grant it", async () => {
    await db.storeMembership.create({
      data: { userId: IDS.staffA, storeId: IDS.storeA, role: "STORE_MANAGER" },
    });
    const m = await db.storeMembership.findUnique({
      where: { userId_storeId: { userId: IDS.staffA, storeId: IDS.storeA } },
    });

    expect(
      canConfigurePos({ tenantRole: "STAFF", storeBelongsToTenant: true, membershipRole: m!.role }),
    ).toBe(true);
  });

  it("owner of tenant A is refused on tenant B's store even though they are an OWNER", async () => {
    // The store lookup is what fails first — B's store is invisible when scoped to A.
    const store = await db.store.findFirst({ where: { id: IDS.storeB, tenantId: IDS.tenantA } });
    expect(store).toBeNull();

    expect(
      canConfigurePos({ tenantRole: "OWNER", storeBelongsToTenant: false, membershipRole: "OWNER" }),
    ).toBe(false);
  });
});

describe("database constraints are actually enforced by PostgreSQL", () => {
  async function expectUniqueViolationOn(fn: () => Promise<unknown>, field: string) {
    try {
      await fn();
      throw new Error("expected a unique constraint violation, but the write succeeded");
    } catch (err) {
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      const target = (err as Prisma.PrismaClientKnownRequestError).meta?.target;
      const text = Array.isArray(target) ? (target as string[]).join(",") : String(target);
      expect(text).toContain(field);
    }
  }

  it("User.email is globally unique across tenants", async () => {
    await expectUniqueViolationOn(
      () =>
        db.user.create({
          data: {
            tenantId: IDS.tenantB,
            email: "owner-a@example.com", // already belongs to tenant A
            passwordHash: FIXTURE_PASSWORD_HASH,
            name: "Impostor",
          },
        }),
      "email",
    );
  });

  it("Store code is unique per tenant, but reusable across tenants", async () => {
    await expectUniqueViolationOn(
      () =>
        db.store.create({
          data: {
            tenantId: IDS.tenantA,
            name: "Duplicate",
            code: "SA",
            currency: "INR",
            addressLine: "x",
            city: "x",
            state: "x",
          },
        }),
      "code",
    );

    // The same code under a different tenant is legitimate.
    const ok = await db.store.create({
      data: {
        tenantId: IDS.tenantB,
        name: "B second",
        code: "SA",
        currency: "INR",
        addressLine: "x",
        city: "x",
        state: "x",
      },
    });
    expect(ok.code).toBe("SA");
  });

  it("StoreMembership is unique per (user, store) — double acceptance is impossible", async () => {
    await expectUniqueViolationOn(
      () =>
        db.storeMembership.create({
          data: { userId: IDS.ownerA, storeId: IDS.storeA, role: "CASHIER" },
        }),
      "userId",
    );
  });

  it("Invitation is unique per (tenant, store, email)", async () => {
    const base = {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      email: "hire@example.com",
      role: "CASHIER",
      inviterUserId: IDS.ownerA,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await db.invitation.create({ data: { ...base, tokenHash: "1".repeat(64) } });

    await expectUniqueViolationOn(
      () => db.invitation.create({ data: { ...base, tokenHash: "2".repeat(64) } }),
      "email",
    );
  });

  it("PosDevice code is unique per store", async () => {
    const base = { tenantId: IDS.tenantA, storeId: IDS.storeA, createdByUserId: IDS.ownerA };
    await db.posDevice.create({ data: { ...base, name: "Counter 1", code: "POS-01" } });

    await expectUniqueViolationOn(
      () => db.posDevice.create({ data: { ...base, name: "Counter 2", code: "POS-01" } }),
      "code",
    );
  });

  it("a foreign key to a nonexistent tenant is rejected", async () => {
    await expect(
      db.user.create({
        data: {
          tenantId: "t-does-not-exist",
          email: "ghost@example.com",
          passwordHash: FIXTURE_PASSWORD_HASH,
          name: "Ghost",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("records that a cross-tenant membership is NOT blocked by the schema", async () => {
    // Deliberately documented rather than asserted-away: the foreign keys are satisfied, so
    // PostgreSQL permits a tenant-A user to be given membership of a tenant-B store. Nothing
    // in the schema prevents it. The guard is application-level (posRoles.canConfigurePos
    // and the tenant-scoped store lookup), and this test exists so that fact stays visible
    // instead of being assumed away.
    const created = await db.storeMembership.create({
      data: { userId: IDS.staffA, storeId: IDS.storeB, role: "CASHIER" },
    });
    expect(created.id).toBeTruthy();

    const leak = await db.storeMembership.findMany({
      where: { storeId: IDS.storeB, user: { tenantId: IDS.tenantA } },
    });
    expect(leak).toHaveLength(1);
  });
});

describe("real transaction behaviour", () => {
  it("two concurrent onboarding claims: exactly one wins (real row lock)", async () => {
    // This is the assertion the mocked suites cannot make. Both transactions issue the same
    // conditional updateMany; PostgreSQL serializes them on the tenant row.
    const claim = (code: string) =>
      db.$transaction(async (tx) => {
        const claimed = await tx.tenant.updateMany({
          where: { id: IDS.tenantA, onboardingStep: "STORE_CREATED" },
          data: { onboardingStep: "POS_CONFIGURED" },
        });
        if (claimed.count === 0) return "lost";
        await tx.posDevice.create({
          data: {
            tenantId: IDS.tenantA,
            storeId: IDS.storeA,
            name: "Main Counter",
            code,
            createdByUserId: IDS.ownerA,
          },
        });
        return "won";
      });

    const results = await Promise.all([claim("POS-01"), claim("POS-02")]);

    expect(results.filter((r) => r === "won")).toHaveLength(1);
    expect(results.filter((r) => r === "lost")).toHaveLength(1);
    // The loser created no device — the whole transaction rolled back.
    expect(await db.posDevice.count()).toBe(1);
    const tenant = await db.tenant.findUnique({ where: { id: IDS.tenantA } });
    expect(tenant?.onboardingStep).toBe("POS_CONFIGURED");
  });

  it("a failed transaction leaves nothing behind", async () => {
    const before = await db.posDevice.count();

    await expect(
      db.$transaction(async (tx) => {
        await tx.posDevice.create({
          data: {
            tenantId: IDS.tenantA,
            storeId: IDS.storeA,
            name: "Doomed",
            code: "POS-DOOM",
            createdByUserId: IDS.ownerA,
          },
        });
        throw new Error("abort after write");
      }),
    ).rejects.toThrow("abort after write");

    expect(await db.posDevice.count()).toBe(before);
    expect(await db.posDevice.findFirst({ where: { code: "POS-DOOM" } })).toBeNull();
  });

  it("a unique violation inside a transaction rolls the whole thing back", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.store.create({
          data: {
            tenantId: IDS.tenantA,
            name: "First",
            code: "NEW1",
            currency: "INR",
            addressLine: "x",
            city: "x",
            state: "x",
          },
        });
        // Duplicate of the seeded store code — violates @@unique([tenantId, code]).
        await tx.store.create({
          data: {
            tenantId: IDS.tenantA,
            name: "Second",
            code: "SA",
            currency: "INR",
            addressLine: "x",
            city: "x",
            state: "x",
          },
        });
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await db.store.findFirst({ where: { code: "NEW1" } })).toBeNull();
    expect(await db.store.count()).toBe(2);
  });
});

describe("session persistence", () => {
  it("a session round-trips and is scoped to its tenant", async () => {
    const created = await db.session.create({
      data: {
        userId: IDS.ownerA,
        tenantId: IDS.tenantA,
        tokenHash: "c".repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const found = await db.session.findUnique({
      where: { tokenHash: "c".repeat(64) },
      include: { user: true },
    });

    expect(found?.id).toBe(created.id);
    expect(found?.user.tenantId).toBe(IDS.tenantA);
    expect(found?.revokedAt).toBeNull();
  });

  it("session tokenHash is unique — a hash collision cannot create a second session", async () => {
    await db.session.create({
      data: {
        userId: IDS.ownerA,
        tenantId: IDS.tenantA,
        tokenHash: "d".repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await expect(
      db.session.create({
        data: {
          userId: IDS.ownerB,
          tenantId: IDS.tenantB,
          tokenHash: "d".repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
