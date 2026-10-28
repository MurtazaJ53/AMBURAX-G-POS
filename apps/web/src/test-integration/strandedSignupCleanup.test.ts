import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { registerBusiness } from "@/server/tenant/registrationService";
import { cleanupStrandedSignups } from "@/server/tenant/strandedSignupCleanup";

/** Bug 31 against real PostgreSQL: stranded sign-ups go, everything else stays. */

const GSTIN = "24ABCDE1234F1Z6";
const DAY = 24 * 60 * 60 * 1000;
const quiet = () => {};

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

let seq = 0;
/** A sign-up through the real registration path (capabilities, garment masters, UOM, token). */
async function signUp(name: string, opts: { taxId?: string; ageDays?: number } = {}): Promise<string> {
  seq += 1;
  const result = await registerBusiness({
    businessName: name,
    businessType: "RETAIL",
    country: "IN",
    taxId: opts.taxId,
    gstScheme: opts.taxId ? "REGULAR" : undefined,
    contactEmail: `signup-${seq}@example.test`,
    contactPhone: "+910000000099",
    idempotencyKey: `stranded-${seq}-${Date.now()}`,
    ip: `10.9.0.${seq % 250}`,
    userAgent: null,
    correlationId: `stranded-${seq}`,
  });
  expect(result.status).toBe("ok");
  const tenant = await db.tenant.findFirstOrThrow({ where: { name }, orderBy: { createdAt: "desc" } });
  await db.tenant.update({
    where: { id: tenant.id },
    data: { createdAt: new Date(Date.now() - (opts.ageDays ?? 8) * DAY) },
  });
  return tenant.id;
}

describe("cleanupStrandedSignups", () => {
  it("only reports in a dry run", async () => {
    const id = await signUp("Stranded Dry");
    const summary = await cleanupStrandedSignups({ delete: false, log: quiet });
    expect(summary.matched.map((t) => t.id)).toEqual([id]);
    expect(summary.deleted).toEqual([]);
    expect(await db.tenant.count({ where: { id } })).toBe(1);
  });

  it("deletes a stranded sign-up and frees its GSTIN for a fresh sign-up", async () => {
    const id = await signUp("Stranded GST", { taxId: GSTIN });
    const summary = await cleanupStrandedSignups({ delete: true, log: quiet });
    expect(summary.deleted).toEqual([id]);
    expect(await db.tenant.count({ where: { id } })).toBe(0);
    expect(await db.onboardingSession.count({ where: { tenantId: id } })).toBe(0);
    expect(await db.uom.count({ where: { tenantId: id } })).toBe(0);
    expect(await db.tenantCapability.count({ where: { tenantId: id } })).toBe(0);

    const fresh = await signUp("Fresh GST", { taxId: GSTIN, ageDays: 0 });
    expect(await db.tenant.findMany({ where: { taxId: GSTIN }, select: { id: true } })).toEqual([{ id: fresh }]);
  });

  it("never touches a recent, progressed, owned or ERPNext-linked tenant", async () => {
    const recent = await signUp("Recent", { ageDays: 6 });
    const progressed = await signUp("Progressed");
    await db.tenant.update({ where: { id: progressed }, data: { onboardingStep: "OWNER_CREATED" } });
    const owned = await signUp("Owned");
    await db.user.create({
      data: { tenantId: owned, email: "owned@example.test", name: "O", passwordHash: "x", tenantRole: "OWNER" },
    });
    const linked = await signUp("Linked");
    await db.tenant.update({ where: { id: linked }, data: { erpnextCompanyId: "Linked Co" } });
    const provisioning = await signUp("Provisioning");
    await db.tenant.update({ where: { id: provisioning }, data: { erpnextProvisionStatus: "PROVISIONING" } });
    await db.tenant.updateMany({
      where: { id: { in: [IDS.tenantA, IDS.tenantB] } },
      data: { createdAt: new Date(Date.now() - 30 * DAY) },
    });

    const summary = await cleanupStrandedSignups({ delete: true, log: quiet });
    expect(summary.matched).toEqual([]);
    expect(await db.tenant.count()).toBe(7);
  });
});
