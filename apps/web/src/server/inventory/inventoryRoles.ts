/**
 * Who may change stock.
 *
 * Same shape as `posRoles.ts` and `storeRoles.ts`, and named from the same vocabulary —
 * `INVENTORY_MANAGER` is already one of `INVITABLE_STORE_ROLES`, and PERMISSIONS.md gives it
 * "catalog/inventory/GRN/transfer/stock-take permissions". This file does not invent a role;
 * it decides which of the existing ones may move stock.
 *
 * Deliberately narrower than selling. A cashier rings up sales all day, and that is exactly
 * why they must not be able to write a receipt or an adjustment: the ability to increase
 * stock without a purchase, or to write off a shortage, is the ability to conceal theft. A
 * sale decrements stock through an audited transaction with a customer and a payment
 * attached; an adjustment is a bare assertion that reality changed.
 */
export const INVENTORY_STORE_ROLES = ["OWNER", "STORE_MANAGER", "INVENTORY_MANAGER"] as const;

export type InventoryStoreRole = (typeof INVENTORY_STORE_ROLES)[number];

export function isInventoryStoreRole(role: string): role is InventoryStoreRole {
  return (INVENTORY_STORE_ROLES as readonly string[]).includes(role);
}

/**
 * Tenant OWNER always may — ownership is established once, at A6, and an owner locked out of
 * their own stockroom by a missing membership row would be absurd. Otherwise a store
 * membership in one of the inventory roles is required.
 *
 * `membershipRole` is `null` when the user has no membership at that store at all, which is a
 * refusal rather than a default.
 */
export function canManageInventory(params: {
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}): boolean {
  if (params.tenantRole === "OWNER") return true;
  return params.membershipRole !== null && isInventoryStoreRole(params.membershipRole);
}
