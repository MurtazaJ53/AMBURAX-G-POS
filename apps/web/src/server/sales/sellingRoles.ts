/**
 * Who may ring up a sale.
 *
 * These lived in `saleService.ts` until the POS session foundation needed them too. Selling
 * authority is a fact about roles, not about the sale transaction, and leaving it inside the
 * transaction module forced a cycle: `saleService` needs the session service to verify a shift,
 * and the session service needs the role rule to decide who may open a till.
 *
 * Both behaviours are unchanged, and `saleService` re-exports them, so every existing caller and
 * its tests keep working exactly as before.
 */

/** A sale moves money; not every membership should. */
export const SELLING_STORE_ROLES = ["OWNER", "STORE_MANAGER", "SALES_ASSOCIATE", "CASHIER"] as const;

export function canSell(params: {
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}): boolean {
  // A tenant OWNER can sell in any of their own stores; the store lookup has already
  // confirmed the store belongs to their tenant before this is called.
  if (params.tenantRole === "OWNER") return true;
  return (
    params.membershipRole !== null &&
    (SELLING_STORE_ROLES as readonly string[]).includes(params.membershipRole)
  );
}
