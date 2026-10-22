import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * A12 — Store / Workspace Selection.
 *
 * Which stores a signed-in user may work in, and which one this session is working in.
 *
 * Access rule (PERMISSIONS.md): a store-scoped screen requires an explicit StoreMembership.
 * The tenant OWNER is the one exception the rest of the product already makes (canSell,
 * canManageInventory): they may work in any of their own stores.
 *
 * The choice lives on the Session row, server-side. A client never names its store per
 * request; it asks to switch once, and every request after that re-checks access, so revoking
 * a membership takes effect on the very next request.
 */

export interface AvailableStore {
  id: string;
  name: string;
  code: string;
  storeType: "RETAIL" | "WAREHOUSE";
  city: string;
  state: string;
  isDefault: boolean;
  /** Null for an owner with no membership row in that store. */
  role: string | null;
  /** People with a membership in the store. */
  staffCount: number;
  /** Products with stock on hand in the store (the store's own count, not the catalogue). */
  itemsInStock: number;
}

export async function listAvailableStores(params: {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
}): Promise<AvailableStore[]> {
  const memberships = await db.storeMembership.findMany({
    where: { userId: params.userId, tenantId: params.tenantId },
    select: { storeId: true, role: true },
  });
  const roleByStore = new Map(memberships.map((m) => [m.storeId, m.role]));

  const stores = await db.store.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.tenantRole === "OWNER" ? {} : { id: { in: [...roleByStore.keys()] } }),
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      storeType: true,
      city: true,
      state: true,
      isDefault: true,
      _count: { select: { memberships: true, stockLevels: { where: { quantity: { gt: 0 } } } } },
    },
  });

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    storeType: s.storeType,
    city: s.city,
    state: s.state,
    isDefault: s.isDefault,
    role: roleByStore.get(s.id) ?? null,
    staffCount: s._count.memberships,
    itemsInStock: s._count.stockLevels,
  }));
}

/** May this user work in this store? Owner: any store of their tenant. Staff: a membership. */
export async function canAccessStore(params: {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  storeId: string;
}): Promise<boolean> {
  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!store) return false;
  if (params.tenantRole === "OWNER") return true;
  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: params.userId, storeId: params.storeId } },
    select: { storeId: true },
  });
  return membership !== null;
}

export type SelectStoreResult = { status: "ok"; storeId: string } | { status: "forbidden" };

/** Switch this session's working store. Audited; refused for a store the user cannot access. */
export async function selectActiveStore(params: {
  sessionId: string;
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  storeId: string;
  correlationId?: string;
}): Promise<SelectStoreResult> {
  if (!(await canAccessStore(params))) return { status: "forbidden" };
  const updated = await db.session.updateMany({
    where: { id: params.sessionId, userId: params.userId, tenantId: params.tenantId, revokedAt: null },
    data: { activeStoreId: params.storeId },
  });
  if (updated.count === 0) return { status: "forbidden" };
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "ContextChanged",
    correlationId: params.correlationId ?? randomUUID(),
    metadata: { storeId: params.storeId, sessionId: params.sessionId },
  });
  return { status: "ok", storeId: params.storeId };
}
