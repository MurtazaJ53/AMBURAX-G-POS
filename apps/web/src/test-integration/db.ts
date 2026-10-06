import { PrismaClient } from "@prisma/client";
import { seedDefaultCapabilities } from "@/server/capability/capabilityService";

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
/**
 * The stock each seeded variant starts with, and the opening movement that explains it.
 * Exported so a test can reason about deltas instead of hard-coding the fixture's numbers.
 */
export const SEEDED_STOCK = { variantA1: 10, variantA2: 4, variantB1: 7 } as const;

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
 * The public table list, read once per process.
 *
 * The schema cannot change while a suite is running, so asking `pg_tables` before every single
 * test bought nothing and cost ~18ms × every test in the run.
 */
let tableNames: string[] | null = null;

async function publicTables(): Promise<string[]> {
  if (tableNames) return tableNames;
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  tableNames = rows.map((r) => r.tablename);
  return tableNames;
}

/**
 * Empty every table between tests.
 *
 * This used to be one `TRUNCATE ... RESTART IDENTITY CASCADE` over all 32 tables, which reads
 * like the obviously faster choice and was the single thing making this suite unusable.
 *
 * Measured against this project's Docker-for-Windows Postgres:
 *
 *   TRUNCATE all 32 tables ............ ~1350 ms
 *   TRUNCATE exactly 1 table .......... ~1557 ms   <- the same
 *   DELETE all 32 tables (this) ....... ~25 ms
 *
 * The cost does not scale with the number of tables, because it is not the row removal that is
 * expensive: each `TRUNCATE` rewrites table files and forces an fsync, and on a virtiofs-backed
 * Docker volume one fsync costs over a second. Thirty-two tables or one, it is the same single
 * penalty — which is also why truncating "only the dirty tables" would have saved nothing.
 *
 * With `beforeEach` running this once per test, that fixed penalty was roughly three quarters of
 * the entire integration run: 539 tests × ~1.35s ≈ 12 minutes of a measured 15.
 *
 * `DELETE` is also what removes the parallel deadlocks. `TRUNCATE` takes an AccessExclusiveLock
 * on every table it names, so two workers truncating the same 32 tables acquire those locks in
 * whatever order each plan chooses, and Postgres reports `40P01 deadlock detected`. `DELETE`
 * takes RowExclusiveLock, which does not self-conflict that way.
 *
 * Two details keep this exactly equivalent to the TRUNCATE it replaces:
 *
 *   - `SET LOCAL session_replication_role = replica` disables foreign-key triggers for the
 *     duration of the transaction, so the deletes need no dependency ordering — the same
 *     property `CASCADE` was providing. `LOCAL` scopes it to this transaction, so it reverts on
 *     commit *and* on rollback; the session can never be left with FK checks disabled.
 *   - `RESTART IDENTITY` is not reproduced because it has nothing to restart: no model in
 *     `schema.prisma` uses `autoincrement()`, so the schema owns no identity sequences.
 *
 * `_prisma_migrations` is deliberately excluded — wiping it would make the database look
 * unmigrated to `prisma migrate status`.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await publicTables();
  if (tables.length === 0) return;
  await db.$transaction([
    db.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
    ...tables.map((t) => db.$executeRawUnsafe(`DELETE FROM "public"."${t}"`)),
  ]);
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

  // Both tenants get the same default capabilities a real tenant gets, through the same
  // function registration calls. Hand-writing the rows here would let fixture and production
  // drift apart, and the first symptom would be a POS test passing against a grant no real
  // tenant receives.
  await seedDefaultCapabilities(db, IDS.tenantA);
  await seedDefaultCapabilities(db, IDS.tenantB);
}

/**
 * A sellable catalogue and a customer for each tenant.
 *
 * Prices are round numbers in paise with a 5% (500bp) inclusive tax rate, chosen so that
 * an assertion failure reads as arithmetic rather than as a puzzle.
 */
export async function seedCommerce(): Promise<void> {
  await db.product.create({
    data: { id: COMMERCE_IDS.productA, tenantId: IDS.tenantA, name: "A Shirt", category: "Products" },
  });
  await db.product.create({
    data: { id: COMMERCE_IDS.productB, tenantId: IDS.tenantB, name: "B Shirt", category: "Products" },
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

  // Each seeded balance gets the OPENING_BALANCE movement that explains it. Writing a
  // `stock_levels` row on its own would seed a state the real system can no longer produce:
  // since P1-8B every balance is the sum of its movements, and a fixture that violated that
  // invariant would make `findProjectionMismatches` report a fixture as a bug.
  for (const seeded of [
    { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1, quantity: 10 },
    { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA2, quantity: 4 },
    { tenantId: IDS.tenantB, storeId: IDS.storeB, variantId: COMMERCE_IDS.variantB1, quantity: 7 },
  ]) {
    await db.stockLevel.create({ data: seeded });
    await db.stockMovement.create({
      data: {
        tenantId: seeded.tenantId,
        storeId: seeded.storeId,
        variantId: seeded.variantId,
        type: "OPENING_BALANCE",
        quantityDelta: seeded.quantity,
        balanceAfter: seeded.quantity,
        reason: "Fixture opening balance.",
        idempotencyKey: `FIXTURE_OPENING:${seeded.storeId}:${seeded.variantId}`,
      },
    });
  }

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
