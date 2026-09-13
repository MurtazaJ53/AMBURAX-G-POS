import { describe, expect, it } from "vitest";
import { canManageInventory, isInventoryStoreRole } from "@/server/inventory/inventoryRoles";
import {
  validateMovementQuantity,
  movementKey,
  MAX_MOVEMENT_QUANTITY,
} from "@/server/inventory/stockLedger";

/**
 * The parts of the inventory foundation that are pure logic: who may move stock, what counts
 * as a valid quantity, and how idempotency keys are derived.
 *
 * Everything that depends on a transaction — the projection invariant, concurrency, rollback,
 * cross-tenant rejection — is tested against real PostgreSQL in
 * `src/test-integration/inventory.test.ts`. Mocked Prisma cannot demonstrate an atomic
 * increment or a lost update, so asserting those here would prove nothing.
 */

describe("who may move stock", () => {
  it("lets a tenant owner manage inventory with no store membership at all", () => {
    // An owner locked out of their own stockroom by a missing membership row would be absurd,
    // and the store was already confirmed to belong to their tenant before this is called.
    expect(canManageInventory({ tenantRole: "OWNER", membershipRole: null })).toBe(true);
  });

  it("lets a store manager and an inventory manager in", () => {
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: "STORE_MANAGER" })).toBe(true);
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: "INVENTORY_MANAGER" })).toBe(
      true,
    );
  });

  it("keeps a cashier out — selling stock is not the same authority as creating it", () => {
    // The point of the separation: someone who can write a receipt or an adjustment can
    // conceal theft. Ringing up a sale is audited against a customer and a payment.
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: "CASHIER" })).toBe(false);
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: "SALES_ASSOCIATE" })).toBe(
      false,
    );
  });

  it("refuses a staff user with no membership", () => {
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: null })).toBe(false);
  });

  it("refuses an unrecognised role rather than defaulting to allowed", () => {
    // StoreMembership.role is a free string today, so a typo in a seed or an invitation must
    // fail closed.
    expect(canManageInventory({ tenantRole: "STAFF", membershipRole: "INVENTORY_MANGER" })).toBe(
      false,
    );
    expect(isInventoryStoreRole("")).toBe(false);
  });
});

describe("movement quantity contract", () => {
  it("accepts positive and negative whole numbers", () => {
    expect(validateMovementQuantity(1)).toBeNull();
    expect(validateMovementQuantity(-7)).toBeNull();
    expect(validateMovementQuantity(MAX_MOVEMENT_QUANTITY)).toBeNull();
    expect(validateMovementQuantity(-MAX_MOVEMENT_QUANTITY)).toBeNull();
  });

  it("rejects zero — a no-op is not a movement", () => {
    expect(validateMovementQuantity(0)).toBe("zero");
  });

  it("rejects fractions rather than rounding them", () => {
    // Rounding here would silently change a balance that money depends on. Decimal quantities
    // arrive with UOM in a later phase, as a deliberate type change, not as a coercion.
    expect(validateMovementQuantity(1.5)).toBe("not_an_integer");
    expect(validateMovementQuantity(-0.1)).toBe("not_an_integer");
  });

  it("rejects values that are not finite numbers at all", () => {
    expect(validateMovementQuantity(NaN)).toBe("not_an_integer");
    expect(validateMovementQuantity(Infinity)).toBe("not_an_integer");
    expect(validateMovementQuantity("5")).toBe("not_an_integer");
    expect(validateMovementQuantity(null)).toBe("not_an_integer");
    expect(validateMovementQuantity(undefined)).toBe("not_an_integer");
  });

  it("rejects quantities beyond the boundary in both directions", () => {
    expect(validateMovementQuantity(MAX_MOVEMENT_QUANTITY + 1)).toBe("too_large");
    expect(validateMovementQuantity(-(MAX_MOVEMENT_QUANTITY + 1))).toBe("too_large");
  });
});

describe("idempotency keys", () => {
  it("derives a sale key from the sale and the variant, not from randomness", () => {
    // Deterministic is the point: a retry of the same fact must collide on the unique index
    // instead of applying a second decrement.
    expect(movementKey.sale("sale-1", "variant-1")).toBe("SALE:sale-1:variant-1");
    expect(movementKey.sale("sale-1", "variant-1")).toBe(movementKey.sale("sale-1", "variant-1"));
  });

  it("keeps one line of a multi-line sale distinct from another", () => {
    expect(movementKey.sale("sale-1", "variant-1")).not.toBe(
      movementKey.sale("sale-1", "variant-2"),
    );
  });

  it("namespaces operations so the same request key cannot collide across them", () => {
    expect(movementKey.receipt("abc")).not.toBe(movementKey.adjustment("abc"));
    expect(movementKey.adjustment("abc")).not.toBe(movementKey.stockTake("abc"));
    expect(movementKey.receipt("abc")).toBe("RECEIPT:abc");
  });
});
