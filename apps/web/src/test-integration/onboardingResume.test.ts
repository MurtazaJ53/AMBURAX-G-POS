import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { getOnboardingResume } from "@/server/onboarding/resume";

/**
 * P1-5 against REAL PostgreSQL.
 *
 * The unit suite proves the decision function. This proves the things only real rows can:
 * that the decision follows authoritative state through every stage, that one tenant's
 * onboarding is invisible and immutable to another, and that a genuinely corrupt state
 * stops rather than loops.
 *
 * Stated plainly: tenant isolation here is enforced by the application's `where tenantId`
 * clauses, not by a database policy. These tests verify that those clauses are present and
 * effective — they do not demonstrate row-level security, because none is configured.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

/** The fixture seeds both tenants at STORE_CREATED with one store each. */
async function setStep(tenantId: string, onboardingStep: string) {
  await db.tenant.update({
    where: { id: tenantId },
    data: { onboardingStep: onboardingStep as never },
  });
}

describe("an interrupted owner resumes at the correct stage", () => {
  const stages: [string, string][] = [
    ["OWNER_CREATED", "/onboarding/store"],
    ["STORE_CREATED", "/onboarding/team"],
    ["TEAM_INVITED", "/onboarding/pos"],
    ["POS_CONFIGURED", "/onboarding/complete"],
  ];

  for (const [step, expected] of stages) {
    it(`resumes a tenant at ${step} to ${expected}`, async () => {
      await setStep(IDS.tenantA, step);

      const decision = await getOnboardingResume({
        tenantId: IDS.tenantA,
        tenantRole: "OWNER",
      });

      expect(decision.path).toBe(expected);
      expect(decision.inconsistent).toBe(false);
    });
  }

  it("reads the step from the database, not from the caller", async () => {
    await setStep(IDS.tenantA, "TEAM_INVITED");
    const first = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    expect(first.path).toBe("/onboarding/pos");

    // Advance the real row; the next call must follow it.
    await setStep(IDS.tenantA, "POS_CONFIGURED");
    const second = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    expect(second.path).toBe("/onboarding/complete");
  });

  it("a refresh or repeated sign-in returns the same destination and changes nothing", async () => {
    await setStep(IDS.tenantA, "OWNER_CREATED");

    const before = await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantA } });
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" }));
    }
    const after = await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantA } });

    expect(results.every((r) => r.path === "/onboarding/store")).toBe(true);
    expect(after.onboardingStep).toBe(before.onboardingStep);
    expect(after.onboardingCompletedAt).toEqual(before.onboardingCompletedAt);
  });
});

describe("completion is final", () => {
  it("a COMPLETE tenant is never sent back into onboarding", async () => {
    await setStep(IDS.tenantA, "COMPLETE");

    const decision = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    expect(decision).toEqual({ path: null, inconsistent: false });
  });

  it("resuming does not move a completed tenant's step", async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { onboardingStep: "COMPLETE", onboardingCompletedAt: new Date() },
    });

    await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    const row = await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantA } });
    expect(row.onboardingStep).toBe("COMPLETE");
    expect(row.onboardingCompletedAt).not.toBeNull();
  });
});

describe("tenant isolation", () => {
  it("tenant A's decision reflects only tenant A's state", async () => {
    await setStep(IDS.tenantA, "OWNER_CREATED");
    await setStep(IDS.tenantB, "POS_CONFIGURED");

    const a = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    const b = await getOnboardingResume({ tenantId: IDS.tenantB, tenantRole: "OWNER" });

    expect(a.path).toBe("/onboarding/store");
    expect(b.path).toBe("/onboarding/complete");
  });

  it("tenant A's store does not satisfy tenant B's consistency check", async () => {
    // B is past the store step but its own store is gone; A still has one. If the lookup
    // were not tenant-scoped, B would look consistent and be sent into the redirect loop.
    await setStep(IDS.tenantB, "TEAM_INVITED");
    await db.storeMembership.deleteMany({ where: { storeId: IDS.storeB } });
    await db.store.delete({ where: { id: IDS.storeB } });

    const b = await getOnboardingResume({ tenantId: IDS.tenantB, tenantRole: "OWNER" });

    expect(b).toEqual({ path: null, inconsistent: true });
    // A is unaffected.
    const a = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    expect(a.inconsistent).toBe(false);
  });

  it("resolving one tenant's resume never mutates the other", async () => {
    await setStep(IDS.tenantA, "OWNER_CREATED");
    const bBefore = await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantB } });

    await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    const bAfter = await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantB } });
    expect(bAfter.onboardingStep).toBe(bBefore.onboardingStep);
    expect(await db.store.count({ where: { tenantId: IDS.tenantB } })).toBe(1);
  });

  it("an unknown tenant id resolves to no resume rather than another tenant's state", async () => {
    const decision = await getOnboardingResume({
      tenantId: "tenant-does-not-exist",
      tenantRole: "OWNER",
    });
    expect(decision).toEqual({ path: null, inconsistent: false });
  });
});

describe("authorization", () => {
  it("a STAFF member of a mid-onboarding tenant is never resumed", async () => {
    // Exactly the A11 case: staff admitted while the owner was still at STORE_CREATED.
    await setStep(IDS.tenantA, "STORE_CREATED");

    const decision = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "STAFF" });

    expect(decision).toEqual({ path: null, inconsistent: false });
  });

  it("the seeded staff user really is STAFF, so that case is not hypothetical", async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { id: IDS.staffA } });
    expect(staff.tenantRole).toBe("STAFF");
    expect(staff.tenantId).toBe(IDS.tenantA);
  });
});

describe("inconsistent state fails safely", () => {
  it("a tenant past the store step with no store stops instead of looping", async () => {
    await setStep(IDS.tenantA, "TEAM_INVITED");
    await db.storeMembership.deleteMany({ where: { storeId: IDS.storeA } });
    await db.store.delete({ where: { id: IDS.storeA } });

    const decision = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    // path null is the whole point: /pos would bounce to /store, which bounces to /home.
    expect(decision).toEqual({ path: null, inconsistent: true });
  });

  it("recovers automatically once the missing store exists again", async () => {
    await setStep(IDS.tenantA, "TEAM_INVITED");
    await db.storeMembership.deleteMany({ where: { storeId: IDS.storeA } });
    await db.store.delete({ where: { id: IDS.storeA } });

    expect(
      (await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" })).path,
    ).toBeNull();

    await db.store.create({
      data: {
        id: IDS.storeA,
        tenantId: IDS.tenantA,
        name: "Store A",
        code: "SA",
        currency: "INR",
        addressLine: "1 A Street",
        city: "Mumbai",
        state: "MH",
        isDefault: true,
      },
    });

    const after = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    expect(after).toEqual({ path: "/onboarding/pos", inconsistent: false });
  });

  it("POS_CONFIGURED with no store still routes to A10, which reports the corruption", async () => {
    await setStep(IDS.tenantA, "POS_CONFIGURED");
    await db.storeMembership.deleteMany({ where: { storeId: IDS.storeA } });
    await db.store.delete({ where: { id: IDS.storeA } });

    const decision = await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    expect(decision).toEqual({ path: "/onboarding/complete", inconsistent: true });
  });
});

describe("resume writes nothing", () => {
  it("creates no audit row and no outbox event", async () => {
    await setStep(IDS.tenantA, "STORE_CREATED");
    const audits = await db.auditLog.count();
    const events = await db.outboxEvent.count();

    await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });
    await getOnboardingResume({ tenantId: IDS.tenantA, tenantRole: "OWNER" });

    // Resuming is a navigation decision derived from existing state, not a state change.
    expect(await db.auditLog.count()).toBe(audits);
    expect(await db.outboxEvent.count()).toBe(events);
  });
});
