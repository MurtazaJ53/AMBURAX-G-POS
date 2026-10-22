/**
 * Who may authorise a return.
 *
 * Same shape as `sellingRoles.ts` and `inventoryRoles.ts`, and named from the same vocabulary.
 * This file does not invent a role; it decides which of the existing ones may refund money and
 * put stock back. PERMISSIONS.md settles the question rather than leaving it to taste: it
 * grants Store Manager "Cashier abilities + returns + stock operations + transfers + day close",
 * while Cashier is "POS sales, customer lookup, payment collection, limited discount" and Sales
 * Associate is "POS + customer management + limited discount". Neither is granted returns.
 *
 * So this is deliberately narrower than `canSell`. A return is the one counter operation that
 * does both of the things the inventory rule calls out as theft vectors at once: it increases
 * stock without a purchase, and it takes cash out of the drawer. A cashier rings up sales all
 * day, which is exactly why handing them unsupervised refund authority would be wrong.
 *
 * It is also not `canManageInventory`, close as that list looks. INVENTORY_MANAGER holds
 * "catalog/inventory/GRN/transfer/stock-take permissions" and no refund permission at all, so
 * reusing that predicate would let a stockroom role disburse money.
 */

/** A return moves money out of the drawer and stock back onto the shelf. */
export const RETURN_STORE_ROLES = ["OWNER", "STORE_MANAGER"] as const;

export type ReturnStoreRole = (typeof RETURN_STORE_ROLES)[number];

export function isReturnStoreRole(role: string): role is ReturnStoreRole {
  return (RETURN_STORE_ROLES as readonly string[]).includes(role);
}

/**
 * Tenant OWNER always may — ownership is established once, at A6, and an owner unable to
 * approve a refund in their own shop would be absurd. Otherwise a store membership in one of
 * the return roles is required.
 *
 * `membershipRole` is `null` when the user has no membership at that store at all, which is a
 * refusal rather than a default.
 */
export function canAuthorizeReturn(params: {
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}): boolean {
  if (params.tenantRole === "OWNER") return true;
  return params.membershipRole !== null && isReturnStoreRole(params.membershipRole);
}
