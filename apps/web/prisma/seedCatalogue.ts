import type { PrismaClient } from "@prisma/client";

/**
 * Demo catalogue seed data.
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
  openingStock: number;
}

export interface SeedProduct {
  name: string;
  category: string;
  brand: string;
  /** Tax rate in basis points, applied to every variant of the product. */
  taxRateBp: number;
  variants: SeedVariant[];
}

export const DEMO_CATALOGUE: SeedProduct[] = [
  {
    name: "Cotton Formal Shirt",
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

export const DEMO_CUSTOMERS = [
  { name: "Priya Sharma", phone: "+919000000101" },
  { name: "Rahul Verma", phone: "+919000000102" },
];

export interface SeedCatalogueCounts {
  products: number;
  variants: number;
  customers: number;
}

/**
 * Write the demo catalogue for one tenant and store.
 *
 * Product has no natural unique key in the schema, so it is resolved by (tenant, name)
 * rather than blind-created; otherwise a second run would produce duplicate products.
 * Variants resolve on the tenant-scoped SKU, stock on (store, variant), customers on the
 * tenant-scoped phone.
 */
export async function seedCatalogue(
  db: PrismaClient,
  params: { tenantId: string; storeId: string },
): Promise<SeedCatalogueCounts> {
  let variantCount = 0;

  for (const entry of DEMO_CATALOGUE) {
    const existing = await db.product.findFirst({
      where: { tenantId: params.tenantId, name: entry.name },
      select: { id: true },
    });

    const product =
      existing ??
      (await db.product.create({
        data: {
          tenantId: params.tenantId,
          name: entry.name,
          category: entry.category,
          brand: entry.brand,
        },
        select: { id: true },
      }));

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
      // re-seeding must not reset a count that real sales have since moved.
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

  for (const c of DEMO_CUSTOMERS) {
    await db.customer.upsert({
      where: { tenantId_phone: { tenantId: params.tenantId, phone: c.phone } },
      update: {},
      create: { tenantId: params.tenantId, name: c.name, phone: c.phone },
    });
  }

  return {
    products: DEMO_CATALOGUE.length,
    variants: variantCount,
    customers: DEMO_CUSTOMERS.length,
  };
}
