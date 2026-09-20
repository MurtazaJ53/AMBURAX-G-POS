import type { PrismaClient } from "@prisma/client";

/**
 * Demo catalogue seed data — and the reusable engine both the minimal seed (`db:seed`)
 * and the richer demo dataset (`db:seed:demo`) build on.
 *
 * Kept in its own module so that seed *data* stays separate from the identity seeding
 * logic in seed.ts. Nothing in src/ imports this file: the POS reads whatever the
 * database holds for the signed-in tenant, so deleting this module leaves an empty but
 * fully functional catalogue rather than a broken screen.
 *
 * Garment-first, but the model stays generic for non-garment retail: size and colour are
 * simply null for a variant that has no such dimension (see the belt and the tote).
 *
 * Deterministic and idempotent. Every write is keyed on a natural unique column, so
 * running the seed twice produces identical row counts rather than a second catalogue.
 */

export interface SeedVariant {
  sku: string;
  barcode: string;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor: number | null;
  /**
   * Opening stock for this store. `null` means "do not create a StockLevel row at all" —
   * the ADR-080 "never counted" state — genuinely different from an opening count of 0.
   */
  openingStock: number | null;
}

export interface SeedProduct {
  name: string;
  category: string;
  brand: string;
  /** Optional specific image for this product, overriding category fallback */
  imageUrl?: string;
  /** Tax rate in basis points, applied to every variant of the product. */
  taxRateBp: number;
  variants: SeedVariant[];
}

export const DEMO_CATALOGUE: SeedProduct[] = [
  {
    name: "Cotton Formal Shirt",
    imageUrl: "/products/cotton-formal-shirt.jpg",
    category: "Shirts",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "SHIRT-WHT-M", barcode: "8901234500011", size: "M", colour: "White", priceMinor: 129900, mrpMinor: 159900, openingStock: 24 },
      { sku: "SHIRT-WHT-L", barcode: "8901234500028", size: "L", colour: "White", priceMinor: 129900, mrpMinor: 159900, openingStock: 18 },
      { sku: "SHIRT-BLU-M", barcode: "8901234500035", size: "M", colour: "Blue", priceMinor: 134900, mrpMinor: 164900, openingStock: 12 },
      { sku: "SHIRT-BLU-L", barcode: "8901234500042", size: "L", colour: "Blue", priceMinor: 134900, mrpMinor: 164900, openingStock: 7 },
    ],
  },
  {
    name: "Slim Fit Denim Jeans",
    imageUrl: "/products/slim-fit-denim-jeans.jpg",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "JEAN-IND-32", barcode: "8901234500059", size: "32", colour: "Indigo", priceMinor: 249900, mrpMinor: 299900, openingStock: 15 },
      { sku: "JEAN-IND-34", barcode: "8901234500066", size: "34", colour: "Indigo", priceMinor: 249900, mrpMinor: 299900, openingStock: 9 },
      { sku: "JEAN-BLK-32", barcode: "8901234500073", size: "32", colour: "Black", priceMinor: 259900, mrpMinor: 309900, openingStock: 6 },
    ],
  },
  {
    name: "Printed Cotton Kurta",
    imageUrl: "/products/printed-cotton-kurta.jpg",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "KURTA-GRN-M", barcode: "8901234500080", size: "M", colour: "Green", priceMinor: 179900, mrpMinor: 219900, openingStock: 20 },
      { sku: "KURTA-GRN-L", barcode: "8901234500097", size: "L", colour: "Green", priceMinor: 179900, mrpMinor: 219900, openingStock: 11 },
    ],
  },
  {
    name: "Leather Belt",
    imageUrl: "/products/leather-belt.jpg",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "BELT-BRN-FS", barcode: "8901234500103", size: null, colour: "Brown", priceMinor: 89900, mrpMinor: 109900, openingStock: 30 },
    ],
  },
  {
    name: "Canvas Tote Bag",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "TOTE-NAT-FS", barcode: "8901234500110", size: null, colour: "Natural", priceMinor: 49900, mrpMinor: 59900, openingStock: 40 },
    ],
  },
];

export interface SeedCustomer {
  name: string;
  phone: string;
}

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  { name: "Priya Sharma", phone: "+919000000101" },
  { name: "Rahul Verma", phone: "+919000000102" },
];

export interface SeedCatalogueCounts {
  products: number;
  variants: number;
}

/**
 * Write one catalogue of products/variants/stock for a tenant and store.
 *
 * This is the reusable engine: `seedCatalogue` below calls it with the minimal baseline
 * catalogue, and `prisma/seedDemoCatalogue.ts`'s richer set is applied through the same
 * function for `db:seed:demo` — one idempotent write path, not two.
 *
 * Product has no natural unique key in the schema, so it is resolved by (tenant, name)
 * rather than blind-created; otherwise a second run would produce duplicate products.
 * Variants resolve on the tenant-scoped SKU; stock resolves on (store, variant).
 */
/**
 * Demo artwork for a seeded product.
 *
 * Illustrations keyed by category, not photographs of specific garments. A picture is how a
 * cashier identifies stock, so a demo catalogue that borrowed real product photography would
 * teach the screen to lie the moment a real shop's data replaced it. A flat drawing of "a
 * dress" against a product in the Dresses category is true at the level it claims.
 *
 * Returns null for a category with no drawing, which exercises the placeholder path that
 * most real catalogues will spend most of their life in.
 */
const DEMO_CATEGORY_ART = new Set([
  "accessories",
  "activewear",
  "dresses",
  "ethnic",
  "kids",
  "outerwear",
  "shirts",
  "tops",
  "trousers",
]);

export function demoImageForCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const key = category.trim().toLowerCase();
  return DEMO_CATEGORY_ART.has(key) ? `/demo/catalogue/${key}.svg` : null;
}

export async function seedProductCatalogue(
  db: PrismaClient,
  params: { tenantId: string; storeId: string },
  catalogue: SeedProduct[],
): Promise<SeedCatalogueCounts> {
  let variantCount = 0;

  for (const entry of catalogue) {
    const existing = await db.product.findFirst({
      where: { tenantId: params.tenantId, name: entry.name },
      select: { id: true },
    });

      const imageUrl = entry.imageUrl ?? demoImageForCategory(entry.category);

    const product =
      existing ??
      (await db.product.create({
        data: {
          tenantId: params.tenantId,
          name: entry.name,
          category: entry.category,
          brand: entry.brand,
          imageUrl,
        },
        select: { id: true },
      }));

    // Products seeded before this column existed have no picture, and re-running the seed is
    // how a developer picks one up. Only ever fills a gap — a picture set by hand in the app
    // is not overwritten by a reseed.
    if (existing && imageUrl) {
      // Overwrite if it's null OR if it's one of our fallback SVGs, so developers get real images.
      await db.product.updateMany({
        where: {
          id: existing.id,
          OR: [
            { imageUrl: null },
            { imageUrl: { startsWith: "/demo/catalogue/" } }
          ]
        },
        data: { imageUrl },
      });
    }

    for (const v of entry.variants) {
      const variant = await db.productVariant.upsert({
        where: { tenantId_sku: { tenantId: params.tenantId, sku: v.sku } },
        update: {},
        create: {
          tenantId: params.tenantId,
          productId: product.id,
          sku: v.sku,
          barcode: v.barcode,
          size: v.size,
          colour: v.colour,
          priceMinor: v.priceMinor,
          mrpMinor: v.mrpMinor,
          taxRateBp: entry.taxRateBp,
        },
        select: { id: true },
      });
      variantCount += 1;

      // Opening stock for the operational projection. `update: {}` is deliberate:
      // re-seeding must not reset a count that real sales have since moved. A null
      // openingStock skips this write entirely — that variant stays "never counted"
      // (ADR-080), not silently forced to zero.
      if (v.openingStock !== null) {
        await db.stockLevel.upsert({
          where: { storeId_variantId: { storeId: params.storeId, variantId: variant.id } },
          update: {},
          create: {
            tenantId: params.tenantId,
            storeId: params.storeId,
            variantId: variant.id,
            quantity: v.openingStock,
          },
        });
      }
    }
  }

  return { products: catalogue.length, variants: variantCount };
}

/**
 * Write one roster of customers for a tenant.
 *
 * Resolved on the tenant-scoped phone, matching `createCustomer`'s own deduplication rule
 * (`server/sales/customers.ts`) — re-seeding can never produce a second "Priya Sharma".
 */
export async function seedCustomerRoster(
  db: PrismaClient,
  params: { tenantId: string },
  customers: SeedCustomer[],
): Promise<number> {
  for (const c of customers) {
    await db.customer.upsert({
      where: { tenantId_phone: { tenantId: params.tenantId, phone: c.phone } },
      update: {},
      create: { tenantId: params.tenantId, name: c.name, phone: c.phone },
    });
  }
  return customers.length;
}

/**
 * Write the minimal baseline catalogue and customers for a tenant and store.
 *
 * This is `db:seed`'s entry point — unchanged in behaviour from before this module grew a
 * reusable engine underneath it. `db:seed:demo` calls `seedProductCatalogue` and
 * `seedCustomerRoster` directly with its own, larger data.
 */
export async function seedCatalogue(
  db: PrismaClient,
  params: { tenantId: string; storeId: string },
): Promise<{ products: number; variants: number; customers: number }> {
  const catalogueCounts = await seedProductCatalogue(db, params, DEMO_CATALOGUE);
  const customerCount = await seedCustomerRoster(db, { tenantId: params.tenantId }, DEMO_CUSTOMERS);
  return { ...catalogueCounts, customers: customerCount };
}
