import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";

/**
 * P1-8H — the database's own tenant invariants.
 *
 * Every test here bypasses the service layer entirely and writes through raw Prisma. That is the
 * whole point: a service-level `not_found` proves the code is careful, and this file proves the
 * database is safe even when the code is not. A future bug, a migration script, a console
 * session or an ORM escape hatch all meet the same constraint.
 *
 * The invariant under test:
 *
 *     a child belonging to tenant A cannot reference a parent belonging to tenant B
 *
 * enforced by composite foreign keys of the shape
 *
 *     (child.parentId, child.tenantId) -> parent(id, tenantId)
 *
 * PostgreSQL reports a violation as `P2003` through Prisma. Where a relation is nullable, the
 * MATCH SIMPLE rule applies — the constraint is unchecked while the reference is NULL and
 * enforced the instant a value is supplied — and that behaviour is asserted rather than assumed.
 */

const CORR = "corr-invariants";



beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

/** Every constraint under test rejects with the same PostgreSQL foreign-key violation. */
const FK_VIOLATION = { code: "P2003" };

// ---------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------

describe("product variants belong to their tenant's products", () => {
  it("refuses a variant of tenant A hanging off tenant B's product", async () => {
    await expect(
      db.productVariant.create({
        data: {
          tenantId: IDS.tenantA,
          productId: COMMERCE_IDS.productB,
          sku: "CROSS-1",
          priceMinor: 1000,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  /** Reassignment is the other direction of the same hole, closed by the same key. */
  it("refuses moving an existing variant onto another tenant's product", async () => {
    await expect(
      db.productVariant.update({
        where: { id: COMMERCE_IDS.variantA1 },
        data: { productId: COMMERCE_IDS.productB },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses changing a variant's tenant out from under its product", async () => {
    await expect(
      db.productVariant.update({
        where: { id: COMMERCE_IDS.variantA1 },
        data: { tenantId: IDS.tenantB },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("still allows a legitimate variant", async () => {
    const variant = await db.productVariant.create({
      data: {
        tenantId: IDS.tenantA,
        productId: COMMERCE_IDS.productA,
        sku: "LEGIT-1",
        priceMinor: 1000,
      },
    });
    expect(variant.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------------------------

describe("sales belong to their tenant's store, cashier and customer", () => {
  function saleData(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      billNumber: `INV-${Math.random().toString(36).slice(2, 8)}`,
      cashierUserId: IDS.ownerA,
      subtotalMinor: 1000,
      taxMinor: 0,
      totalMinor: 1000,
      paidMinor: 1000,
      idempotencyKey: `inv-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    };
  }

  it("refuses a sale in another tenant's store", async () => {
    await expect(db.sale.create({ data: saleData({ storeId: IDS.storeB }) })).rejects.toMatchObject(
      FK_VIOLATION,
    );
  });

  it("refuses a sale rung up by another tenant's user", async () => {
    await expect(
      db.sale.create({ data: saleData({ cashierUserId: IDS.ownerB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a sale attributed to another tenant's customer", async () => {
    await expect(
      db.sale.create({ data: saleData({ customerId: COMMERCE_IDS.customerB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  /**
   * `customerId` is nullable, and PostgreSQL's MATCH SIMPLE leaves a composite constraint
   * unchecked when any of its columns is NULL. That is correct here — a walk-in sale genuinely
   * has no customer — and this asserts it rather than assuming it.
   */
  it("allows a walk-in sale with no customer at all", async () => {
    const sale = await db.sale.create({ data: saleData({ customerId: null }) });
    expect(sale.customerId).toBeNull();
  });

  it("refuses attaching a foreign customer to an existing sale", async () => {
    const sale = await db.sale.create({ data: saleData() });
    await expect(
      db.sale.update({ where: { id: sale.id }, data: { customerId: COMMERCE_IDS.customerB } }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });
});

describe("sale lines belong to their sale's tenant", () => {
  async function makeSale() {
    return db.sale.create({
      data: {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        billNumber: `L-${Math.random().toString(36).slice(2, 8)}`,
        cashierUserId: IDS.ownerA,
        subtotalMinor: 1000,
        taxMinor: 0,
        totalMinor: 1000,
        paidMinor: 1000,
        idempotencyKey: `l-${Math.random().toString(36).slice(2)}`,
      },
    });
  }

  function itemData(saleId: string, overrides: Record<string, unknown> = {}) {
    return {
      tenantId: IDS.tenantA,
      saleId,
      variantId: COMMERCE_IDS.variantA1,
      skuSnapshot: "X",
      nameSnapshot: "X",
      quantity: 1,
      unitPriceMinor: 1000,
      taxRateBp: 0,
      taxMinor: 0,
      lineTotalMinor: 1000,
      ...overrides,
    };
  }

  /**
   * The gap this phase closed. Before P1-8H, `sale_items` had no tenantId at all, so nothing
   * stopped a sale line from naming another tenant's product — the line would carry a foreign
   * SKU and name onto this tenant's receipt.
   */
  it("refuses a line referencing another tenant's variant", async () => {
    const sale = await makeSale();
    await expect(
      db.saleItem.create({ data: itemData(sale.id, { variantId: COMMERCE_IDS.variantB1 }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a line whose tenant disagrees with its sale", async () => {
    const sale = await makeSale();
    await expect(
      db.saleItem.create({
        data: itemData(sale.id, { tenantId: IDS.tenantB, variantId: COMMERCE_IDS.variantB1 }),
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses moving a line onto another tenant's sale", async () => {
    const sale = await makeSale();
    const item = await db.saleItem.create({ data: itemData(sale.id) });

    const foreignSale = await db.sale.create({
      data: {
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        billNumber: "B-000001",
        cashierUserId: IDS.ownerB,
        subtotalMinor: 1000,
        taxMinor: 0,
        totalMinor: 1000,
        paidMinor: 1000,
        idempotencyKey: "b-key-1",
      },
    });

    await expect(
      db.saleItem.update({ where: { id: item.id }, data: { saleId: foreignSale.id } }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("still allows a legitimate line", async () => {
    const sale = await makeSale();
    const item = await db.saleItem.create({ data: itemData(sale.id) });
    expect(item.tenantId).toBe(IDS.tenantA);
  });
});

// ---------------------------------------------------------------------------------------------
// Stock levels — the risk carried from P1-8B
// ---------------------------------------------------------------------------------------------

describe("stock levels belong to their tenant", () => {
  /**
   * P1-8B left `stock_levels.tenantId` with no foreign key of any kind. A projection row could
   * name a tenant that did not exist, and a store or variant belonging to someone else. All
   * three are closed here.
   */
  it("refuses a level naming a tenant that does not exist", async () => {
    // A variant the fixture has no level for, so the unique index on (storeId, variantId) is not
    // what refuses this — the tenant foreign key is.
    const fresh = await db.productVariant.create({
      data: {
        tenantId: IDS.tenantA,
        productId: COMMERCE_IDS.productA,
        sku: "NO-LEVEL-1",
        priceMinor: 1000,
      },
    });

    await expect(
      db.stockLevel.create({
        data: {
          tenantId: "t-nonexistent",
          storeId: IDS.storeA,
          variantId: fresh.id,
          quantity: 1,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a level in another tenant's store", async () => {
    await expect(
      db.stockLevel.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          variantId: COMMERCE_IDS.variantA1,
          quantity: 1,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a level for another tenant's variant", async () => {
    await expect(
      db.stockLevel.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          variantId: COMMERCE_IDS.variantB1,
          quantity: 1,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses reassigning an existing level to another tenant", async () => {
    const level = await db.stockLevel.findFirstOrThrow({ where: { tenantId: IDS.tenantA } });
    await expect(
      db.stockLevel.update({ where: { id: level.id }, data: { tenantId: IDS.tenantB } }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------------------------
// Devices and invitations
// ---------------------------------------------------------------------------------------------

describe("POS devices belong to their tenant's store and creator", () => {
  function deviceData(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      code: `D-${Math.random().toString(36).slice(2, 8)}`,
      name: "Till 1",
      createdByUserId: IDS.ownerA,
      ...overrides,
    };
  }

  it("refuses a device registered into another tenant's store", async () => {
    await expect(
      db.posDevice.create({ data: deviceData({ storeId: IDS.storeB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a device created by another tenant's user", async () => {
    await expect(
      db.posDevice.create({ data: deviceData({ createdByUserId: IDS.ownerB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });
});

describe("invitations belong to their tenant's store and users", () => {
  function inviteData(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      email: `invitee-${Math.random().toString(36).slice(2, 8)}@example.com`,
      role: "CASHIER",
      tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
      inviterUserId: IDS.ownerA,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    };
  }

  it("refuses an invitation into another tenant's store", async () => {
    await expect(
      db.invitation.create({ data: inviteData({ storeId: IDS.storeB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses an invitation sent by another tenant's user", async () => {
    await expect(
      db.invitation.create({ data: inviteData({ inviterUserId: IDS.ownerB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  /** Nullable while unaccepted; enforced the moment an accepter is named. */
  it("allows an unaccepted invitation, then refuses a foreign accepter", async () => {
    const invite = await db.invitation.create({ data: inviteData() });
    expect(invite.acceptedByUserId).toBeNull();

    await expect(
      db.invitation.update({ where: { id: invite.id }, data: { acceptedByUserId: IDS.ownerB } }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("allows acceptance by a user of the same tenant", async () => {
    const invite = await db.invitation.create({ data: inviteData() });
    const accepted = await db.invitation.update({
      where: { id: invite.id },
      data: { acceptedByUserId: IDS.staffA },
    });
    expect(accepted.acceptedByUserId).toBe(IDS.staffA);
  });
});

// ---------------------------------------------------------------------------------------------
// Identity — sessions, MFA, password reset
// ---------------------------------------------------------------------------------------------

describe("identity records belong to their user's tenant", () => {
  it("refuses a session whose tenant disagrees with its user", async () => {
    await expect(
      db.session.create({
        data: {
          userId: IDS.ownerA,
          tenantId: IDS.tenantB,
          tokenHash: `s-${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses an MFA challenge whose tenant disagrees with its user", async () => {
    await expect(
      db.mfaChallenge.create({
        data: {
          userId: IDS.ownerA,
          tenantId: IDS.tenantB,
          tokenHash: `mt-${Math.random().toString(36).slice(2)}`,
          codeHash: `m-${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() + 600_000),
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  /** A reset token is a credential; a mismatched one is what an attacker would want to forge. */
  it("refuses a password reset token whose tenant disagrees with its user", async () => {
    await expect(
      db.passwordResetToken.create({
        data: {
          userId: IDS.ownerA,
          tenantId: IDS.tenantB,
          tokenHash: `r-${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("still allows a matching session", async () => {
    const session = await db.session.create({
      data: {
        userId: IDS.ownerA,
        tenantId: IDS.tenantA,
        tokenHash: `ok-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect(session.tenantId).toBe(IDS.tenantA);
  });
});

// ---------------------------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------------------------

describe("outbox events belong to their tenant", () => {
  function eventData(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: IDS.tenantA,
      eventType: "TestEvent",
      correlationId: CORR,
      payload: {},
      idempotencyKey: `e-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    };
  }

  it("refuses an event naming a tenant that does not exist", async () => {
    await expect(
      db.outboxEvent.create({ data: eventData({ tenantId: "t-nonexistent" }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses an event whose store belongs to another tenant", async () => {
    await expect(
      db.outboxEvent.create({ data: eventData({ storeId: IDS.storeB }) }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  /** Most events are not store-scoped; MATCH SIMPLE leaves those unchecked, as intended. */
  it("allows an event with no store at all", async () => {
    const event = await db.outboxEvent.create({ data: eventData({ storeId: null }) });
    expect(event.storeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Relations established in earlier phases — re-proved so the matrix is complete
// ---------------------------------------------------------------------------------------------

describe("the invariants established by earlier phases still hold", () => {
  it("refuses a customer address linking across tenants", async () => {
    const address = await db.address.create({
      data: {
        tenantId: IDS.tenantB,
        line1: "B Street",
        city: "Delhi",
        state: "DL",
        postalCode: "110001",
        country: "IN",
        type: "SHIPPING",
      },
    });

    await expect(
      db.customerAddress.create({
        data: {
          tenantId: IDS.tenantA,
          customerId: COMMERCE_IDS.customerA,
          addressId: address.id,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a price list item for another tenant's variant", async () => {
    const list = await db.priceList.create({
      data: { tenantId: IDS.tenantA, name: "Trade", currency: "INR" },
    });
    const uom = await db.uom.create({
      data: { tenantId: IDS.tenantA, code: "PCS", name: "Pieces" },
    });

    await expect(
      db.priceListItem.create({
        data: {
          tenantId: IDS.tenantA,
          priceListId: list.id,
          variantId: COMMERCE_IDS.variantB1,
          uomId: uom.id,
          minQuantity: 1,
          unitPriceMinor: 1000,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a stock movement in another tenant's store", async () => {
    await expect(
      db.stockMovement.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          variantId: COMMERCE_IDS.variantA1,
          type: "RECEIPT",
          quantityDelta: 1,
          balanceAfter: 1,
          idempotencyKey: `m-${Math.random().toString(36).slice(2)}`,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a store membership across tenants", async () => {
    await expect(
      db.storeMembership.create({
        data: { tenantId: IDS.tenantA, userId: IDS.ownerB, storeId: IDS.storeA, role: "CASHIER" },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses a tenant capability for a tenant that does not exist", async () => {
    await expect(
      db.tenantCapability.create({
        data: { tenantId: "t-nonexistent", capability: "RETAIL", enabled: true },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses an order in another tenant's store", async () => {
    await expect(
      db.order.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          orderNumber: "X-SO-000001",
          currency: "INR",
          idempotencyKey: "x-1",
          createdByUserId: IDS.ownerA,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("refuses an order created by another tenant's user", async () => {
    await expect(
      db.order.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          orderNumber: "X-SO-000002",
          currency: "INR",
          idempotencyKey: "x-2",
          createdByUserId: IDS.ownerB,
        },
      }),
    ).rejects.toMatchObject(FK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------------------------
// The shape of the protection itself
// ---------------------------------------------------------------------------------------------

describe("the constraints exist in PostgreSQL, not merely in Prisma", () => {
  /**
   * Reads `pg_constraint` directly. A schema file can claim anything; this asserts what the
   * database actually enforces, which is the only thing an attacker meets.
   */
  async function compositeKeys(): Promise<Set<string>> {
    const rows = await db.$queryRaw<{ child: string; cols: string }[]>`
      SELECT con.conrelid::regclass::text AS child,
             array_to_string(ARRAY(
               SELECT a.attname FROM unnest(con.conkey) k
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
               ORDER BY a.attname
             ), '+') AS cols
      FROM pg_constraint con
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 2
    `;
    return new Set(rows.map((r) => `${r.child}:${r.cols}`));
  }

  it("has a two-column foreign key on every relation this phase protects", async () => {
    const keys = await compositeKeys();

    for (const expected of [
      "product_variants:productId+tenantId",
      "sale_items:saleId+tenantId",
      "sale_items:tenantId+variantId",
      "sales:storeId+tenantId",
      "sales:cashierUserId+tenantId",
      "sales:customerId+tenantId",
      "stock_levels:storeId+tenantId",
      "stock_levels:tenantId+variantId",
      "pos_devices:storeId+tenantId",
      "pos_devices:createdByUserId+tenantId",
      "invitations:storeId+tenantId",
      "invitations:inviterUserId+tenantId",
      "invitations:acceptedByUserId+tenantId",
      "sessions:tenantId+userId",
      "mfa_challenges:tenantId+userId",
      "password_reset_tokens:tenantId+userId",
      "orders:createdByUserId+tenantId",
      "outbox_events:storeId+tenantId",
    ]) {
      expect(keys.has(expected), `missing composite FK: ${expected}`).toBe(true);
    }
  });

  it("gives stock levels the tenant foreign key P1-8B left out", async () => {
    const rows = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid = 'stock_levels'::regclass
        AND confrelid = 'tenants'::regclass
    `;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  /**
   * The sweep that makes this phase finishable: any tenant-scoped child still pointing at a
   * tenant-owned parent through a single column is an unclosed hole, and this finds it whether
   * or not anyone remembered to write a test for that table.
   */
  it("leaves no single-column foreign key from a tenant-scoped child to a tenant-owned parent", async () => {
    const rows = await db.$queryRaw<{ child: string; parent: string; col: string }[]>`
      SELECT con.conrelid::regclass::text AS child,
             con.confrelid::regclass::text AS parent,
             (SELECT a.attname FROM pg_attribute a
              WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col
      FROM pg_constraint con
      WHERE con.contype = 'f'
        AND array_length(con.conkey, 1) = 1
        AND con.confrelid <> 'tenants'::regclass
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_name = con.conrelid::regclass::text AND c.column_name = 'tenantId'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_name = con.confrelid::regclass::text AND c.column_name = 'tenantId'
        )
    `;
    expect(rows).toEqual([]);
  });
});
