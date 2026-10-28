import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { getUserAllowedModules, updateStaffModulePermissions } from "@/server/identity/staffPermissionsService";

/**
 * A staff member's module access is the latest `staff_module_permissions` record written for
 * them, however many other permission changes the tenant has made since. It used to be read
 * from the tenant's latest 50 such entries, so a busy tenant silently dropped older grants
 * (and older revokes) back to the role default.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

/** `count` later permission changes for other people in the same tenant. */
async function noise(count: number, after: Date) {
  await db.auditLog.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      tenantId: IDS.tenantA,
      userId: IDS.ownerA,
      action: "staff_module_permissions",
      correlationId: `noise-${i}`,
      metadata: { targetUserId: `someone-else-${i}`, allowedModules: ["pos"] },
      createdAt: new Date(after.getTime() + (i + 1) * 1000),
    })),
  });
}

async function setModules(allowedModules: string[]) {
  const result = await updateStaffModulePermissions({
    tenantId: IDS.tenantA,
    actorUserId: IDS.ownerA,
    targetUserId: IDS.staffA,
    allowedModules,
  });
  expect(result).toEqual({ status: "ok" });
  const latest = await db.auditLog.findFirstOrThrow({
    where: { action: "staff_module_permissions" },
    orderBy: { createdAt: "desc" },
  });
  return latest.createdAt;
}

describe("getUserAllowedModules", () => {
  it("keeps a grant that is older than 60 later permission changes", async () => {
    const grantedAt = await setModules(["pos", "reports"]);
    await noise(60, grantedAt);
    expect(await getUserAllowedModules(IDS.tenantA, IDS.staffA)).toEqual(["pos", "reports"]);
  });

  it("keeps a revoke that is older than 60 later permission changes", async () => {
    const grantedAt = await setModules(["pos", "reports", "inventory"]);
    // Revoke strictly after the grant.
    await db.auditLog.updateMany({ data: { createdAt: new Date(grantedAt.getTime() - 60_000) } });
    const revokedAt = await setModules(["pos"]);
    await noise(60, revokedAt);
    expect(await getUserAllowedModules(IDS.tenantA, IDS.staffA)).toEqual(["pos"]);
  });

  it("does not read another tenant's record for the same user id", async () => {
    await db.auditLog.create({
      data: {
        tenantId: IDS.tenantB,
        userId: IDS.ownerB,
        action: "staff_module_permissions",
        correlationId: "other-tenant",
        metadata: { targetUserId: IDS.staffA, allowedModules: ["reports"] },
      },
    });
    expect(await getUserAllowedModules(IDS.tenantA, IDS.staffA)).toBeNull();
  });
});
