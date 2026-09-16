import { PrismaClient } from "@prisma/client";

/**
 * A read-only window onto the database the application is actually writing to.
 *
 * Two jobs, both of which a browser cannot do. It supplies fixture identifiers the product
 * deliberately never sends to a client — the store id, for instance, which the till resolves
 * server-side from the session and has no reason to expose. And it lets a test check what the
 * server really recorded after a sale, rather than trusting the screen that reported it.
 *
 * Nothing here writes. A test that needed to write would be manufacturing the state it claims
 * to be verifying, which is the failure mode this whole suite exists to avoid.
 */
export const db = new PrismaClient();

export async function demoTenant() {
  const tenant = await db.tenant.findFirstOrThrow({
    where: { slug: "demo-retail" },
    select: { id: true, slug: true, onboardingStep: true },
  });
  const store = await db.store.findFirstOrThrow({
    where: { tenantId: tenant.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, code: true },
  });
  return { tenant, store };
}

/** A real sellable variant with a real barcode, for the scan tests. */
export async function aSellableVariant(tenantId: string) {
  return db.productVariant.findFirstOrThrow({
    where: { tenantId, isActive: true, barcode: { not: null }, product: { isActive: true } },
    select: {
      id: true,
      sku: true,
      barcode: true,
      priceMinor: true,
      taxRateBp: true,
      product: { select: { name: true } },
    },
  });
}
