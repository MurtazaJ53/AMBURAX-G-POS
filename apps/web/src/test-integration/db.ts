import { PrismaClient } from "@prisma/client";

/**
 * A real PrismaClient for integration tests.
 *
 * Deliberately its own instance rather than `@/server/db`: the app's singleton is designed
 * for a long-lived server process, and tests need to disconnect deterministically at the
 * end of a run.
 */
export const db = new PrismaClient();

/**
 * Deterministic fixture ids. Fixed strings rather than generated ones so a failure message
 * names something a human can grep for, and so no test can accidentally depend on
 * insertion order or randomness.
 */
export const IDS = {
  tenantA: "t-aaaaaaaaaaaaaaaaaaaaaaaa",
  tenantB: "t-bbbbbbbbbbbbbbbbbbbbbbbb",
  ownerA: "u-aaaaaaaaaaaaaaaaaaaaaaaa",
  ownerB: "u-bbbbbbbbbbbbbbbbbbbbbbbb",
  staffA: "u-sssssssssssssssssssssssa",
  storeA: "s-aaaaaaaaaaaaaaaaaaaaaaaa",
  storeB: "s-bbbbbbbbbbbbbbbbbbbbbbbb",
} as const;

/**
 * Catalogue fixtures, kept separate from `IDS` because only the sale tests need them.
 *
 * Each tenant gets its own product, variant and customer. That symmetry is what makes the
 * cross-tenant assertions meaningful: "tenant A cannot sell tenant B's product" is only a
 * real test if tenant B's product genuinely exists and is genuinely sellable — by B.
 */
export const COMMERCE_IDS = {
  productA: "p-aaaaaaaaaaaaaaaaaaaaaaaa",
  productB: "p-bbbbbbbbbbbbbbbbbbbbbbbb",
  variantA1: "v-aaaaaaaaaaaaaaaaaaaaaaa1",
  variantA2: "v-aaaaaaaaaaaaaaaaaaaaaaa2",
  variantB1: "v-bbbbbbbbbbbbbbbbbbbbbbb1",
  customerA: "c-aaaaaaaaaaaaaaaaaaaaaaaa",
  customerB: "c-bbbbbbbbbbbbbbbbbbbbbbbb",
} as const;

/**
 * Truncate every table between tests. `RESTART IDENTITY CASCADE` in one statement is both
 * faster than per-table deletes and immune to foreign-key ordering, which would otherwise
 * make the reset depend on the schema's shape.
 *
 * `_prisma_migrations` is deliberately excluded — wiping it would make the database look
 * unmigrated to `prisma migrate status`.
 */
export async function resetDatabase(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Never a real credential — a fixed bcrypt-shaped string, since nothing here verifies it. */
export const FIXTURE_PASSWORD_HASH = "$2a$10$fixturefixturefixturefixturefixturefixturefixtureAB";

/**
 * Two fully separate tenants, each with an owner and a store. This is the shape every
 * isolation assertion needs: if a query leaks across the A/B boundary, it is a real
 * cross-tenant data leak.
 */
export async function seedTwoTenants(): Promise<void> {
  await db.tenant.create({
    data: {
      id: IDS.tenantA,
      name: "Tenant A Retail",
      slug: "tenant-a",
      businessType: "RETAIL",
      country: "IN",
      contactEmail: "owner-a@example.com",
      contactPhone: "+910000000001",
      termsAcceptedAt: new Date(),
      onboardingStep: "STORE_CREATED",
    },
  });
  await db.tenant.create({
    data: {
      id: IDS.tenantB,
      name: "Tenant B Retail",
      slug: "tenant-b",
      businessType: "RETAIL",
      country: "IN",
      contactEmail: "owner-b@example.com",
      contactPhone: "+910000000002",
      termsAcceptedAt: new Date(),
      onboardingStep: "STORE_CREATED",
    },
  });

  await db.user.create({
    data: {
      id: IDS.ownerA,
      tenantId: IDS.tenantA,
      email: "owner-a@example.com",
      passwordHash: FIXTURE_PASSWORD_HASH,
      name: "Owner A",
      tenantRole: "OWNER",
    },
  });
  await db.user.create({
    data: {
      id: IDS.ownerB,
      tenantId: IDS.tenantB,
      email: "owner-b@example.com",
      passwordHash: FIXTURE_PASSWORD_HASH,
      name: "Owner B",
      tenantRole: "OWNER",
    },
  });
  await db.user.create({
    data: {
      id: IDS.staffA,
      tenantId: IDS.tenantA,
      email: "staff-a@example.com",
      passwordHash: FIXTURE_PASSWORD_HASH,
      name: "Staff A",
      tenantRole: "STAFF",
    },
  });

  await db.store.create({
    data: {
      id: IDS.storeA,
      tenantId: IDS.tenantA,
      name: "Store A",
      code: "SA",
      currency: "INR",
      addressLine: "1 A Street",
      city: "Mumbai",
      state: "MH",
      isDefault: true,
    },
  });
  await db.store.create({
    data: {
      id: IDS.storeB,
      tenantId: IDS.tenantB,
      name: "Store B",
      code: "SB",
      currency: "INR",
      addressLine: "1 B Street",
      city: "Delhi",
      state: "DL",
      isDefault: true,
    },
  });

  await db.storeMembership.create({
    data: { tenantId: IDS.tenantA, userId: IDS.ownerA, storeId: IDS.storeA, role: "OWNER" },
  });
  await db.storeMembership.create({
    data: { tenantId: IDS.tenantB, userId: IDS.ownerB, storeId: IDS.storeB, role: "OWNER" },
  });

  // Note what is deliberately absent: staffA has no StoreMembership at all. That is what
  // makes the "unauthorized cashier is blocked" test test something — the user is real,
  // belongs to tenant A, and still may not sell.
}

/**
 * A sellable catalogue and a customer for each tenant.
 *
 * Prices are round numbers in paise with a 5% (500bp) inclusive tax rate, chosen so that
 * an assertion failure reads as arithmetic rather than as a puzzle.
 */
export async function seedCommerce(): Promise<void> {
  await db.product.create({
    data: { id: COMMERCE_IDS.productA, tenantId: IDS.tenantA, name: "A Shirt", category: "Shirts" },
  });
  await db.product.create({
    data: { id: COMMERCE_IDS.productB, tenantId: IDS.tenantB, name: "B Shirt", category: "Shirts" },
  });

  await db.productVariant.create({
    data: {
      id: COMMERCE_IDS.variantA1,
      tenantId: IDS.tenantA,
      productId: COMMERCE_IDS.productA,
      sku: "A-SHIRT-M",
      barcode: "1000000000001",
      size: "M",
      colour: "White",
      priceMinor: 100_000,
      mrpMinor: 120_000,
      taxRateBp: 500,
    },
  });
  await db.productVariant.create({
    data: {
      id: COMMERCE_IDS.variantA2,
      tenantId: IDS.tenantA,
      productId: COMMERCE_IDS.productA,
      sku: "A-SHIRT-L",
      barcode: "1000000000002",
      size: "L",
      colour: "White",
      priceMinor: 200_000,
      mrpMinor: 240_000,
      taxRateBp: 500,
    },
  });
  await db.productVariant.create({
    data: {
      id: COMMERCE_IDS.variantB1,
      tenantId: IDS.tenantB,
      productId: COMMERCE_IDS.productB,
      sku: "B-SHIRT-M",
      barcode: "2000000000001",
      size: "M",
      colour: "Black",
      priceMinor: 150_000,
      taxRateBp: 500,
    },
  });

  await db.stockLevel.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantity: 10,
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA2,
      quantity: 4,
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: IDS.tenantB,
      storeId: IDS.storeB,
      variantId: COMMERCE_IDS.variantB1,
      quantity: 7,
    },
  });

  await db.customer.create({
    data: {
      id: COMMERCE_IDS.customerA,
      tenantId: IDS.tenantA,
      name: "Customer A",
      phone: "+919000000001",
    },
  });
  await db.customer.create({
    data: {
      id: COMMERCE_IDS.customerB,
      tenantId: IDS.tenantB,
      name: "Customer B",
      phone: "+919000000002",
    },
  });
}
