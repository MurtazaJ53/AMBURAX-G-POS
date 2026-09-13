import { PrismaClient } from "@prisma/client";
import { logError } from "../src/lib/safeLog";
import { seedProductCatalogue, seedCustomerRoster } from "./seedCatalogue";
import { DEMO_EXTRA_CATALOGUE, DEMO_EXTRA_CUSTOMERS } from "./seedDemoCatalogue";
import { seedDemoSales } from "./seedDemoSales";

/**
 * `db:seed:demo` — the richer dataset for a live demo.
 *
 * Deliberately separate from `db:seed`. `db:seed` is the minimal deterministic baseline
 * every developer and the integration test fixtures can assume exists; layering ~60 sales
 * and ~60 extra catalogue rows onto it would make that baseline slower and less obviously
 * correct to read at a glance. This script instead assumes `db:seed` has already run —
 * it looks up the tenant and store `db:seed` creates and fails loudly if they are missing,
 * rather than creating a second tenant under a different identity. That would be exactly
 * the kind of orphaned duplicate state this project's rules forbid.
 *
 * Every write here is idempotent for the same reason `db:seed`'s is: products and
 * customers resolve on their natural keys, and sales resolve on a deterministic
 * `demo-seed-sale-<index>` idempotency key via `createSale`'s own duplicate-key path (see
 * seedDemoSales.ts) — never a manual "does this already exist" check duplicated here.
 */

const db = new PrismaClient();

async function main() {
  const tenant = await db.tenant.findUnique({ where: { slug: "demo-retail" } });
  if (!tenant) {
    throw new Error(
      "Demo tenant not found. Run `npm run db:seed` before `npm run db:seed:demo`.",
    );
  }

  const store = await db.store.findUnique({
    where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } },
  });
  if (!store) {
    throw new Error(
      "Main Store not found. Run `npm run db:seed` before `npm run db:seed:demo`.",
    );
  }

  const catalogueCounts = await seedProductCatalogue(
    db,
    { tenantId: tenant.id, storeId: store.id },
    DEMO_EXTRA_CATALOGUE,
  );
  const customerCount = await seedCustomerRoster(
    db,
    { tenantId: tenant.id },
    DEMO_EXTRA_CUSTOMERS,
  );

  const sales = await seedDemoSales(db, { tenantId: tenant.id, storeId: store.id });

  console.log("Seeded demo dataset.");
  console.log(`  extra catalogue: +${catalogueCounts.products} products, +${catalogueCounts.variants} variants`);
  console.log(`  extra customers: +${customerCount}`);
  console.log(`  demo sales: ${sales.created} created, ${sales.duplicate} already existed`);
  console.log(
    `  sale dates: today ${sales.dateCounts.today}, yesterday ${sales.dateCounts.yesterday}, last 7 days ${sales.dateCounts.last7}, older ${sales.dateCounts.older}`,
  );
  if (sales.failed.length > 0) {
    // Not fatal by itself — a failed sale attempt leaves nothing behind (the tested
    // rollback guarantee) — but it means the demo has fewer sales than intended, and the
    // presenter should know before walking on stage rather than during.
    console.log(`  WARNING: ${sales.failed.length} demo sale(s) could not be created:`, sales.failed);
  }
}

main()
  .catch((err) => {
    logError("prisma/seedDemo: seeding failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
