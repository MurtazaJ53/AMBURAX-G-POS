import { describe, expect, it } from "vitest";
import { canSell, SELLING_STORE_ROLES } from "@/server/sales/saleService";

/**
 * Who may take money.
 *
 * This predicate is not the enforcement point — `createSale` re-derives it from the
 * database inside the transaction — but it is the definition both the API and the UI
 * depend on, so it is pinned here on its own.
 */

describe("canSell", () => {
  it("allows a tenant owner regardless of store membership", () => {
    // The store lookup has already proved the store belongs to this owner's tenant before
    // this is called, so an owner without an explicit membership row is still the owner.
    expect(canSell({ tenantRole: "OWNER", membershipRole: null })).toBe(true);
    expect(canSell({ tenantRole: "OWNER", membershipRole: "CASHIER" })).toBe(true);
  });

  it("allows staff holding a selling role in the store", () => {
    for (const role of SELLING_STORE_ROLES) {
      expect(canSell({ tenantRole: "STAFF", membershipRole: role })).toBe(true);
    }
  });

  it("blocks staff with no membership in the store", () => {
    // A real user, in the right tenant, with no business at this till.
    expect(canSell({ tenantRole: "STAFF", membershipRole: null })).toBe(false);
  });

  it("blocks staff whose store role does not include selling", () => {
    expect(canSell({ tenantRole: "STAFF", membershipRole: "VIEWER" })).toBe(false);
    expect(canSell({ tenantRole: "STAFF", membershipRole: "ACCOUNTANT" })).toBe(false);
  });

  it("blocks an unrecognised role rather than defaulting to permitted", () => {
    // Fail closed: a role added to the schema but not to SELLING_STORE_ROLES must not
    // silently acquire the ability to take money.
    expect(canSell({ tenantRole: "STAFF", membershipRole: "SOMETHING_NEW" })).toBe(false);
    expect(canSell({ tenantRole: "STAFF", membershipRole: "" })).toBe(false);
  });
});
