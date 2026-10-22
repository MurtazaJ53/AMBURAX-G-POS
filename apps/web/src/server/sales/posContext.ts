import { db } from "@/server/db";
import { resolveSession } from "@/server/identity/session";
import { canSell } from "@/server/sales/saleService";

/**
 * The operating context for every POS request: who is asking, for which tenant, in which
 * store, and whether they may sell there.
 *
 * This exists because a POS request needs more scope than a session carries. A session
 * answers "who" and "which tenant"; a till also needs "which store", and the store is the
 * boundary that stock counts, bill numbers and permissions hang off. Resolving it here,
 * once, is what keeps every route from re-deriving it slightly differently.
 *
 * Everything is read server-side from the session cookie. There is deliberately no
 * parameter by which a client could name its own tenant, user, store or role — a request
 * body that contained `tenantId` would be ignored, not honoured.
 */

export interface PosContext {
  tenantId: string;
  userId: string;
  userName: string;
  tenantRole: "OWNER" | "STAFF";
  storeId: string;
  storeName: string;
  storeCode: string;
  /** Null when the user has no membership in this store (possible for a tenant OWNER). */
  membershipRole: string | null;
  /** Whether this user may ring up a sale in this store. */
  canSell: boolean;
}

export type PosContextResult =
  | { status: "unauthorized" }
  /** Authenticated, but the tenant has no store yet — onboarding is incomplete. */
  | { status: "no_store" }
  | { status: "ok"; context: PosContext };

/**
 * Resolve the caller's POS context from their session token.
 *
 * Store selection: the tenant's default store, falling back to its oldest. Multi-store
 * switching is not built in this slice, and picking implicitly rather than accepting a
 * client-supplied store id is the safe default — a client-named store would have to be
 * re-authorized against membership anyway, so nothing is gained by accepting one yet.
 */
export async function resolvePosContext(
  sessionToken: string | undefined | null,
): Promise<PosContextResult> {
  if (!sessionToken) return { status: "unauthorized" };

  const session = await resolveSession(sessionToken);
  if (!session) return { status: "unauthorized" };

  // A12: the store this session chose, if any — re-checked on every request, so a removed
  // membership stops working immediately. Otherwise the tenant's default store, as before.
  let store: { id: string; name: string; code: string } | null = null;
  if (session.activeStoreId) {
    const chosen = await db.store.findFirst({
      where: { id: session.activeStoreId, tenantId: session.tenantId },
      select: { id: true, name: true, code: true },
    });
    if (chosen) {
      const allowed =
        session.user.tenantRole === "OWNER" ||
        (await db.storeMembership.findUnique({
          where: { userId_storeId: { userId: session.userId, storeId: chosen.id } },
          select: { storeId: true },
        })) !== null;
      if (allowed) store = chosen;
    }
  }
  store ??= await db.store.findFirst({
    where: { tenantId: session.tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, code: true },
  });
  if (!store) return { status: "no_store" };

  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: session.userId, storeId: store.id } },
    select: { role: true },
  });

  const tenantRole = session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF";
  const membershipRole = membership?.role ?? null;

  return {
    status: "ok",
    context: {
      tenantId: session.tenantId,
      userId: session.userId,
      userName: session.user.name,
      tenantRole,
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      membershipRole,
      // Same predicate the sale transaction re-checks. Evaluating it here lets the UI
      // hide what the user cannot do; it is emphatically not the enforcement point —
      // createSale re-derives it from the database on every sale.
      canSell: canSell({ tenantRole, membershipRole }),
    },
  };
}
