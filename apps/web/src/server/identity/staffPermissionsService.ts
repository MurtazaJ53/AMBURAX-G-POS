import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { INVITABLE_STORE_ROLES, type InvitableStoreRole, isInvitableStoreRole } from "@/server/tenant/storeRoles";

export interface TenantStaffMember {
  id: string;
  name: string;
  email: string;
  tenantRole: "OWNER" | "STAFF";
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  lastLoginAt: Date | null;
  idleTimeoutMinutes: number | null;
  hasApprovalPin: boolean;
  customModuleAccess?: string[] | null;
  stores: {
    membershipId: string;
    storeId: string;
    storeName: string;
    storeCode: string;
    role: string;
  }[];
}

export interface PendingInvitationSummary {
  id: string;
  email: string;
  role: string;
  storeName: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function listTenantStaff(tenantId: string): Promise<{
  staff: TenantStaffMember[];
  pendingInvitations: PendingInvitationSummary[];
  stores: { id: string; name: string; code: string }[];
}> {
  const [users, invitations, stores, moduleAuditEntries] = await Promise.all([
    db.user.findMany({
      where: { tenantId },
      orderBy: [{ tenantRole: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        tenantRole: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        idleTimeoutMinutes: true,
        approvalPinHash: true,
        memberships: {
          select: {
            id: true,
            role: true,
            storeId: true,
            store: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },
    }),
    db.invitation.findMany({
      where: {
        tenantId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        store: { select: { name: true } },
      },
    }),
    db.store.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.auditLog.findMany({
      where: { tenantId, action: "staff_module_permissions" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    }),
  ]);

  // Build a map of latest module permissions per user
  const userModuleMap = new Map<string, string[]>();
  for (const entry of moduleAuditEntries) {
    const meta = entry.metadata as { targetUserId?: string; allowedModules?: string[] } | null;
    if (meta?.targetUserId && meta?.allowedModules && !userModuleMap.has(meta.targetUserId)) {
      userModuleMap.set(meta.targetUserId, meta.allowedModules);
    }
  }

  const staff: TenantStaffMember[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    tenantRole: u.tenantRole,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    idleTimeoutMinutes: u.idleTimeoutMinutes,
    hasApprovalPin: Boolean(u.approvalPinHash),
    customModuleAccess: userModuleMap.get(u.id) || null,
    stores: u.memberships.map((m) => ({
      membershipId: m.id,
      storeId: m.storeId,
      storeName: m.store.name,
      storeCode: m.store.code,
      role: m.role,
    })),
  }));

  const pending: PendingInvitationSummary[] = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    storeName: inv.store.name,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }));

  return { staff, pendingInvitations: pending, stores };
}

export async function updateStaffModulePermissions(params: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  allowedModules: string[];
}): Promise<{ status: "ok" } | { status: "forbidden" }> {
  const targetUser = await db.user.findFirst({
    where: { id: params.targetUserId, tenantId: params.tenantId },
    select: { tenantRole: true },
  });

  if (!targetUser || targetUser.tenantRole === "OWNER") {
    return { status: "forbidden" };
  }

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "staff_module_permissions",
    correlationId: `module-perm-${Date.now()}`,
    metadata: {
      targetUserId: params.targetUserId,
      allowedModules: params.allowedModules,
      updatedAt: new Date().toISOString(),
    },
  });

  return { status: "ok" };
}

export async function getUserAllowedModules(tenantId: string, userId: string): Promise<string[] | null> {
  // The `staff_module_permissions` records written by updateStaffModulePermissions are the only
  // store of custom module access. Read this user's latest one directly — never a window of the
  // tenant's recent entries, which drops older grants and revokes once others pile up.
  const latest = await db.auditLog.findFirst({
    where: {
      tenantId,
      action: "staff_module_permissions",
      metadata: { path: ["targetUserId"], equals: userId },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  const meta = latest?.metadata as { allowedModules?: unknown } | null | undefined;
  return Array.isArray(meta?.allowedModules) ? (meta.allowedModules as string[]) : null;
}

export async function updateStaffRole(params: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  storeId: string;
  newRole: string;
}): Promise<{ status: "ok" } | { status: "forbidden" | "invalid_role" | "not_found" }> {
  if (!isInvitableStoreRole(params.newRole)) {
    return { status: "invalid_role" };
  }

  // Prevent modifying owner account
  const targetUser = await db.user.findFirst({
    where: { id: params.targetUserId, tenantId: params.tenantId },
    select: { tenantRole: true },
  });
  if (!targetUser || targetUser.tenantRole === "OWNER") {
    return { status: "forbidden" };
  }

  // The store must be this tenant's: another business's store id must never get a membership.
  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!store) {
    return { status: "not_found" };
  }

  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: params.targetUserId, storeId: params.storeId } },
  });

  if (membership) {
    await db.storeMembership.update({
      where: { id: membership.id },
      data: { role: params.newRole },
    });
  } else {
    await db.storeMembership.create({
      data: {
        tenantId: params.tenantId,
        userId: params.targetUserId,
        storeId: params.storeId,
        role: params.newRole,
      },
    });
  }

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "staff_role_updated",
    correlationId: `role-${Date.now()}`,
    metadata: {
      targetUserId: params.targetUserId,
      storeId: params.storeId,
      newRole: params.newRole,
    },
  });

  return { status: "ok" };
}

export async function toggleStaffStatus(params: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  active: boolean;
}): Promise<{ status: "ok" } | { status: "forbidden" }> {
  const targetUser = await db.user.findFirst({
    where: { id: params.targetUserId, tenantId: params.tenantId },
    select: { tenantRole: true },
  });

  if (!targetUser || targetUser.tenantRole === "OWNER") {
    return { status: "forbidden" };
  }

  // Disabling must end the user's access now, not when their sessions expire: the status
  // change and the revocation of every live session commit together.
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: params.targetUserId },
      data: { status: params.active ? "ACTIVE" : "DISABLED" },
    });
    if (!params.active) {
      await tx.session.updateMany({
        where: { userId: params.targetUserId, tenantId: params.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: params.active ? "staff_activated" : "staff_disabled",
    correlationId: `status-${Date.now()}`,
    metadata: { targetUserId: params.targetUserId },
  });

  return { status: "ok" };
}
