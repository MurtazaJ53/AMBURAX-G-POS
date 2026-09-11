/**
 * Who may create/configure a POS terminal.
 *
 * Deliberately NOT `tenantRole === 'OWNER'` alone. PERMISSIONS.md already documents
 * store-scoped roles, and "the person who sets up the till" is a store-operations job a
 * Store Manager plainly does — hard-coding tenant ownership here would mean every new
 * terminal in every future store has to go through the business owner personally.
 *
 * Distinct from `storeRoles.ts`'s `INVITABLE_STORE_ROLES`, which answers a different
 * question ("what role may an invitation grant"). Two allow-lists because they are two
 * different authorization facts; merging them would mean widening who can be invited in
 * order to widen who can configure a till, or vice versa.
 *
 * Note this list contains 'OWNER' — that is `StoreMembership.role`, the row A7 creates
 * for the owner's own store, not `User.tenantRole`. The two axes stay separate; see
 * `canConfigurePos` for how they combine.
 */
export const POS_CONFIGURABLE_STORE_ROLES = ["OWNER", "STORE_MANAGER"] as const;

export type PosConfigurableStoreRole = (typeof POS_CONFIGURABLE_STORE_ROLES)[number];

export function isPosConfigurableStoreRole(role: string): role is PosConfigurableStoreRole {
  return (POS_CONFIGURABLE_STORE_ROLES as readonly string[]).includes(role);
}

/**
 * Two conditions, both required, deliberately:
 *
 *  1. `storeBelongsToTenant` — the store is in the caller's own tenant. Cross-tenant is
 *     refused here regardless of any role, because a role string means nothing across a
 *     tenant boundary.
 *  2. Either tenant ownership, or a store-scoped role on *that specific store*.
 *
 * A tenant OWNER is allowed without a membership row: they own every store in the tenant
 * by definition, and requiring a membership would break the legitimate case of an owner
 * setting up a store they don't personally staff. A STAFF user gets no such shortcut —
 * they need a membership on the exact store, which is what blocks "has access to Store A,
 * tries to register a terminal under Store B".
 */
export function canConfigurePos(params: {
  tenantRole: "OWNER" | "STAFF";
  storeBelongsToTenant: boolean;
  membershipRole: string | null;
}): boolean {
  if (!params.storeBelongsToTenant) return false;
  if (params.tenantRole === "OWNER") return true;
  return params.membershipRole !== null && isPosConfigurableStoreRole(params.membershipRole);
}
