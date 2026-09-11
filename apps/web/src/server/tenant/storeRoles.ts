/**
 * `StoreMembership.role` is a free string, not a schema enum (see schema.prisma's comment
 * on that model for why it stays that way). That means the privilege-escalation guard for
 * "what role can an invitation grant" has to live here, in code, checked at invitation
 * creation — and must be checked again wherever A11 later turns an accepted invitation
 * into a real StoreMembership row, using this same list.
 *
 * Deliberately excludes 'OWNER': tenant ownership is established exactly once, at A6, for
 * the tenant's first user (see DECISIONS.md ADR-041) — never through an invitation payload.
 * Named after PERMISSIONS.md's documented example roles (Owner/Admin is the one omitted).
 */
export const INVITABLE_STORE_ROLES = [
  "STORE_MANAGER",
  "SALES_ASSOCIATE",
  "CASHIER",
  "INVENTORY_MANAGER",
  "ACCOUNTANT",
] as const;

export type InvitableStoreRole = (typeof INVITABLE_STORE_ROLES)[number];

export function isInvitableStoreRole(role: string): role is InvitableStoreRole {
  return (INVITABLE_STORE_ROLES as readonly string[]).includes(role);
}
