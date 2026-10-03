import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import {
  createCustomerAddress,
  listCustomerAddresses,
  updateCustomerAddress,
  setDefaultAddress,
  deactivateAddress,
  setCustomerGstin,
  linkAddressToCustomer,
  type AddressInput,
} from "@/server/address/addressService";
import { createSale } from "@/server/sales/saleService";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/**
 * Addresses against REAL PostgreSQL: tenant isolation, the composite foreign keys, and the
 * default-address contract.
 *
 * Validation is pure and lives in `src/test/addressValidation.test.ts`.
 */

const CORR = "corr-address";

function address(over: Partial<AddressInput> = {}): AddressInput {
  return {
    line1: "12 Ring Road",
    city: "Ahmedabad",
    state: "Gujarat",
    postalCode: "380001",
    country: "IN",
    type: "SHIPPING",
    ...over,
  };
}

function create(
  over: Partial<AddressInput> = {},
  opts: { customerId?: string; makeDefault?: boolean } = {},
) {
  return createCustomerAddress({
    tenantId: IDS.tenantA,
    actorUserId: IDS.ownerA,
    customerId: opts.customerId ?? COMMERCE_IDS.customerA,
    address: address(over),
    makeDefault: opts.makeDefault,
    correlationId: CORR,
  });
}

async function customerRow(id: string) {
  return db.customer.findUniqueOrThrow({
    where: { id },
    select: { defaultBillingAddressId: true, defaultShippingAddressId: true, gstin: true },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("creating and listing addresses", () => {
  it("creates an address and links it to the customer", async () => {
    const result = await create();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.address.city).toBe("Ahmedabad");
    expect(result.address.isActive).toBe(true);

    // Both halves of the transaction landed: the address exists and so does the link.
    expect(await db.address.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
    expect(
      await db.customerAddress.count({
        where: { customerId: COMMERCE_IDS.customerA, addressId: result.address.id },
      }),
    ).toBe(1);
  });

  it("holds several addresses for one customer", async () => {
    await create({ line1: "Shop 1", type: "BILLING" });
    await create({ line1: "Warehouse 2", type: "SHIPPING" });
    await create({ line1: "Head office", type: "BOTH" });

    const listed = await listCustomerAddresses({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
    });

    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.addresses).toHaveLength(3);
    expect(listed.addresses.map((a) => a.type).sort()).toEqual(["BILLING", "BOTH", "SHIPPING"]);
  });

  it("stores each of the three address types", async () => {
    for (const type of ["BILLING", "SHIPPING", "BOTH"] as const) {
      const result = await create({ line1: `${type} place`, type });
      expect(result.status === "ok" && result.address.type).toBe(type);
    }
  });

  it("rejects an address with a missing required field and writes nothing", async () => {
    const result = await create({ city: "" });

    expect(result).toMatchObject({ status: "validation_error", field: "city" });
    expect(await db.address.count()).toBe(0);
    expect(await db.customerAddress.count()).toBe(0);
  });

  it("links one address to a second customer of the same tenant", async () => {
    // The reason this is a join table: a group buyer's shared godown is one address that more
    // than one customer record delivers to.
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const second = await db.customer.create({
      data: { tenantId: IDS.tenantA, name: "Sister firm", phone: "+910000009999" },
    });

    const linked = await linkAddressToCustomer({
      tenantId: IDS.tenantA,
      customerId: second.id,
      addressId: created.address.id,
    });

    expect(linked.status).toBe("ok");
    expect(await db.customerAddress.count({ where: { addressId: created.address.id } })).toBe(2);
  });

  it("linking twice is idempotent rather than an error", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const again = await linkAddressToCustomer({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
      addressId: created.address.id,
    });

    expect(again.status).toBe("ok");
    expect(await db.customerAddress.count({ where: { addressId: created.address.id } })).toBe(1);
  });
});

describe("updating an address", () => {
  it("edits in place", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const updated = await updateCustomerAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      addressId: created.address.id,
      address: address({ line1: "45 New Road", city: "Surat" }),
      correlationId: CORR,
    });

    expect(updated.status === "ok" && updated.address.line1).toBe("45 New Road");
    expect(updated.status === "ok" && updated.address.city).toBe("Surat");
  });

  it("refuses another tenant's address", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const result = await updateCustomerAddress({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      addressId: created.address.id,
      address: address({ line1: "Hijacked" }),
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "not_found" });
    const untouched = await db.address.findUniqueOrThrow({ where: { id: created.address.id } });
    expect(untouched.line1).toBe("12 Ring Road");
  });
});

describe("default billing and shipping", () => {
  it("sets a billing default", async () => {
    const billing = await create({ type: "BILLING" });
    if (billing.status !== "ok") throw new Error("setup");

    const result = await setDefaultAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      addressId: billing.address.id,
      purpose: "BILLING",
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    expect((await customerRow(COMMERCE_IDS.customerA)).defaultBillingAddressId).toBe(
      billing.address.id,
    );
  });

  it("sets a shipping default independently of the billing one", async () => {
    const billing = await create({ line1: "Accounts office", type: "BILLING" });
    const shipping = await create({ line1: "Godown", type: "SHIPPING" });
    if (billing.status !== "ok" || shipping.status !== "ok") throw new Error("setup");

    for (const [addressId, purpose] of [
      [billing.address.id, "BILLING"],
      [shipping.address.id, "SHIPPING"],
    ] as const) {
      await setDefaultAddress({
        tenantId: IDS.tenantA,
        actorUserId: IDS.ownerA,
        customerId: COMMERCE_IDS.customerA,
        addressId,
        purpose,
        correlationId: CORR,
      });
    }

    const customer = await customerRow(COMMERCE_IDS.customerA);
    expect(customer.defaultBillingAddressId).toBe(billing.address.id);
    expect(customer.defaultShippingAddressId).toBe(shipping.address.id);
  });

  it("changing the default replaces the previous one — never two at once", async () => {
    const first = await create({ line1: "Old godown", type: "SHIPPING" });
    const second = await create({ line1: "New godown", type: "SHIPPING" });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("setup");

    for (const addressId of [first.address.id, second.address.id]) {
      await setDefaultAddress({
        tenantId: IDS.tenantA,
        actorUserId: IDS.ownerA,
        customerId: COMMERCE_IDS.customerA,
        addressId,
        purpose: "SHIPPING",
        correlationId: CORR,
      });
    }

    // A column holds one value: "two conflicting defaults" is not representable, so there is no
    // stale flag to clear and no window in which both are true.
    const customer = await customerRow(COMMERCE_IDS.customerA);
    expect(customer.defaultShippingAddressId).toBe(second.address.id);

    const listed = await listCustomerAddresses({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
    });
    if (listed.status !== "ok") throw new Error("list failed");
    expect(listed.addresses.filter((a) => a.isDefaultShipping)).toHaveLength(1);
  });

  it("concurrent default changes leave exactly one winner, not a mixture", async () => {
    const first = await create({ line1: "Godown A", type: "SHIPPING" });
    const second = await create({ line1: "Godown B", type: "SHIPPING" });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("setup");

    await Promise.all(
      [first.address.id, second.address.id].map((addressId) =>
        setDefaultAddress({
          tenantId: IDS.tenantA,
          actorUserId: IDS.ownerA,
          customerId: COMMERCE_IDS.customerA,
          addressId,
          purpose: "SHIPPING",
          correlationId: CORR,
        }),
      ),
    );

    const customer = await customerRow(COMMERCE_IDS.customerA);
    expect([first.address.id, second.address.id]).toContain(customer.defaultShippingAddressId);
  });

  it("a BOTH address can be either default", async () => {
    const both = await create({ line1: "Head office", type: "BOTH" });
    if (both.status !== "ok") throw new Error("setup");

    for (const purpose of ["BILLING", "SHIPPING"] as const) {
      const result = await setDefaultAddress({
        tenantId: IDS.tenantA,
        actorUserId: IDS.ownerA,
        customerId: COMMERCE_IDS.customerA,
        addressId: both.address.id,
        purpose,
        correlationId: CORR,
      });
      expect(result.status).toBe("ok");
    }
  });

  it("a BILLING address cannot become the shipping default", async () => {
    // Sending goods to an accounts office is a mistake worth refusing.
    const billing = await create({ type: "BILLING" });
    if (billing.status !== "ok") throw new Error("setup");

    const result = await setDefaultAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      addressId: billing.address.id,
      purpose: "SHIPPING",
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "validation_error" });
    expect((await customerRow(COMMERCE_IDS.customerA)).defaultShippingAddressId).toBeNull();
  });

  it("an address that is not linked to the customer cannot be its default", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const other = await db.customer.create({
      data: { tenantId: IDS.tenantA, name: "Unrelated", phone: "+910000008888" },
    });

    const result = await setDefaultAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: other.id,
      addressId: created.address.id,
      purpose: "SHIPPING",
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "not_found", what: "address" });
  });

  it("makeDefault on create sets the right pointers for the type", async () => {
    const both = await create({ type: "BOTH" }, { makeDefault: true });
    if (both.status !== "ok") throw new Error("setup");

    const customer = await customerRow(COMMERCE_IDS.customerA);
    expect(customer.defaultBillingAddressId).toBe(both.address.id);
    expect(customer.defaultShippingAddressId).toBe(both.address.id);
  });
});

describe("deactivation", () => {
  it("retires an address rather than deleting it", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");

    const result = await deactivateAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      addressId: created.address.id,
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    const row = await db.address.findUniqueOrThrow({ where: { id: created.address.id } });
    expect(row.isActive).toBe(false);
    // Still there — history is not deleted.
    expect(await db.address.count()).toBe(1);
  });

  it("an inactive address disappears from the default listing but can be asked for", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");
    await deactivateAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      addressId: created.address.id,
      correlationId: CORR,
    });

    const active = await listCustomerAddresses({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
    });
    const all = await listCustomerAddresses({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
      includeInactive: true,
    });

    expect(active.status === "ok" && active.addresses).toHaveLength(0);
    expect(all.status === "ok" && all.addresses).toHaveLength(1);
  });

  it("refuses to retire an address that is still somebody's default", async () => {
    // Silently clearing the pointer would lose a customer's delivery address without telling
    // anyone, and they would find out at the worst possible moment.
    const created = await create({ type: "BOTH" }, { makeDefault: true });
    if (created.status !== "ok") throw new Error("setup");

    const result = await deactivateAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      addressId: created.address.id,
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "in_use" });
    const row = await db.address.findUniqueOrThrow({ where: { id: created.address.id } });
    expect(row.isActive).toBe(true);
  });

  it("an inactive address cannot be made a default", async () => {
    const created = await create();
    if (created.status !== "ok") throw new Error("setup");
    await deactivateAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      addressId: created.address.id,
      correlationId: CORR,
    });

    const result = await setDefaultAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      addressId: created.address.id,
      purpose: "SHIPPING",
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "validation_error" });
  });
});

describe("tenant isolation", () => {
  it("tenant B cannot list tenant A's customer addresses", async () => {
    await create();

    const result = await listCustomerAddresses({
      tenantId: IDS.tenantB,
      customerId: COMMERCE_IDS.customerA,
    });

    // The customer is another tenant's, so it simply does not exist here — no existence oracle.
    expect(result).toMatchObject({ status: "not_found", what: "customer" });
  });

  it("tenant A cannot attach an address to tenant B's customer", async () => {
    const result = await createCustomerAddress({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerB,
      address: address(),
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "not_found", what: "customer" });
    expect(await db.address.count()).toBe(0);
  });

  it("tenant A cannot link tenant B's address to its own customer", async () => {
    const bAddress = await createCustomerAddress({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      customerId: COMMERCE_IDS.customerB,
      address: address({ line1: "B Street" }),
      correlationId: CORR,
    });
    if (bAddress.status !== "ok") throw new Error("setup");

    const result = await linkAddressToCustomer({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
      addressId: bAddress.address.id,
    });

    expect(result).toMatchObject({ status: "not_found", what: "address" });
  });

  it("PostgreSQL rejects a link between a tenant-A customer and a tenant-B address", async () => {
    // The composite foreign keys, not the application guard. Every id is individually valid;
    // only the combination is wrong.
    const bAddress = await createCustomerAddress({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      customerId: COMMERCE_IDS.customerB,
      address: address({ line1: "B Street" }),
      correlationId: CORR,
    });
    if (bAddress.status !== "ok") throw new Error("setup");

    await expect(
      db.customerAddress.create({
        data: {
          tenantId: IDS.tenantA,
          customerId: COMMERCE_IDS.customerA,
          addressId: bAddress.address.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a default pointing at another tenant's address", async () => {
    const bAddress = await createCustomerAddress({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      customerId: COMMERCE_IDS.customerB,
      address: address({ line1: "B Street" }),
      correlationId: CORR,
    });
    if (bAddress.status !== "ok") throw new Error("setup");

    await expect(
      db.customer.update({
        where: { id: COMMERCE_IDS.customerA },
        data: { defaultShippingAddressId: bAddress.address.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("each tenant sees only its own addresses", async () => {
    await create();
    await createCustomerAddress({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      customerId: COMMERCE_IDS.customerB,
      address: address({ line1: "B Street" }),
      correlationId: CORR,
    });

    expect(await db.address.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
    expect(await db.address.count({ where: { tenantId: IDS.tenantB } })).toBe(1);
  });
});

describe("customer GSTIN", () => {
  it("stores a GSTIN", async () => {
    const result = await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });

    expect(result.status === "ok" && result.gstin).toBe("24AAACC1206D1ZM");
    expect((await customerRow(COMMERCE_IDS.customerA)).gstin).toBe("24AAACC1206D1ZM");
  });

  it("uppercases it, so one number has one spelling", async () => {
    await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "24aaacc1206d1zm",
      correlationId: CORR,
    });

    expect((await customerRow(COMMERCE_IDS.customerA)).gstin).toBe("24AAACC1206D1ZM");
  });

  it("rejects something that is not GSTIN-shaped", async () => {
    const result = await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "NOT-A-GSTIN",
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "validation_error", field: "gstin" });
    expect((await customerRow(COMMERCE_IDS.customerA)).gstin).toBeNull();
  });

  it("clears it when asked", async () => {
    await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });
    await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: null,
      correlationId: CORR,
    });

    expect((await customerRow(COMMERCE_IDS.customerA)).gstin).toBeNull();
  });

  it("two tenants may hold the same GSTIN — customer books are independent", async () => {
    const a = await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });
    const b = await setCustomerGstin({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      customerId: COMMERCE_IDS.customerB,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
  });

  it("refuses to set a GSTIN on another tenant's customer", async () => {
    const result = await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerB,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });

    expect(result).toMatchObject({ status: "not_found", what: "customer" });
  });
});

describe("regression: customers, POS and inventory are unchanged", () => {
  it("an existing customer with no address and no GSTIN still works", async () => {
    const customer = await customerRow(COMMERCE_IDS.customerA);
    expect(customer.gstin).toBeNull();
    expect(customer.defaultBillingAddressId).toBeNull();
    expect(customer.defaultShippingAddressId).toBeNull();

    const listed = await listCustomerAddresses({
      tenantId: IDS.tenantA,
      customerId: COMMERCE_IDS.customerA,
    });
    expect(listed.status === "ok" && listed.addresses).toHaveLength(0);
  });

  it("a sale to a customer with no address still completes", async () => {
    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `address-regression-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
      customerId: COMMERCE_IDS.customerA,
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
  });

  it("a sale to a customer with an address and a GSTIN behaves identically", async () => {
    await create({ type: "BOTH" }, { makeDefault: true });
    await setCustomerGstin({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      gstin: "24AAACC1206D1ZM",
      correlationId: CORR,
    });

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `address-regression-gst-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
      customerId: COMMERCE_IDS.customerA,
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    // Seeded 10, sold 3. Addresses do not touch stock.
    expect(level.quantity).toBe(7);
  });

  it("the stock ledger and its projection still reconcile", async () => {
    await create({ type: "BOTH" }, { makeDefault: true });
    expect(await findProjectionMismatches(db)).toEqual([]);
  });

  it("store addresses are untouched — still inline columns on the store", async () => {
    // Explicitly deferred: migrating them is a change to onboarding, which this phase does not
    // own.
    const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
    expect(store.addressLine).toBeTruthy();
    expect(store.city).toBeTruthy();
  });
});
