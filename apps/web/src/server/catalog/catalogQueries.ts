import { db } from "@/server/db";

/**
 * Catalogue and stock reads for the Products and Inventory workspaces.
 *
 * Deliberately separate from `server/sales/catalog.ts`, which answers a different question:
 * that module is the till's fast lookup Ã¢â‚¬â€ barcode-first, capped, optimised for a cashier
 * mid-sale. These are paginated management views over the same rows. Merging them would
 * force one query to serve two access patterns and make the counter slower to serve the
 * back office.
 *
 * Every query is scoped by `tenantId` from the caller's resolved session; stock is
 * additionally scoped by `storeId`. The absence of a tenant scope on any query in this file
 * would be a cross-tenant data leak.
 */

export const PAGE_SIZE = 20;

export interface Page<T> {
  rows: T[];
  total: number;
  /** 1-based, clamped to the available range. */
  page: number;
  pageCount: number;
}

export interface ProductVariantRow {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor: number | null;
  isActive: boolean;
  stockQuantity: number | null;
}

export interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  imageUrl: string | null;
  isActive: boolean;
  variantCount: number;
  /** Lowest and highest selling price across the product's variants, in minor units. */
  priceFromMinor: number | null;
  priceToMinor: number | null;
  /**
   * Summed operational count across this store (ADR-080). Null when *no* variant of the
   * product has ever been counted here Ã¢â‚¬â€ different from a genuine zero.
   */
  stockQuantity: number | null;
  variants: ProductVariantRow[];
}

function buildProductWhere(tenantId: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { tenantId };

  return {
    tenantId,
    OR: [
      { name: { contains: trimmed, mode: "insensitive" as const } },
      { category: { contains: trimmed, mode: "insensitive" as const } },
      { brand: { contains: trimmed, mode: "insensitive" as const } },
      { variants: { some: { sku: { contains: trimmed, mode: "insensitive" as const } } } },
      { variants: { some: { barcode: trimmed } } },
    ],
  };
}

/** Clamp a requested page so `?page=999` lands on the last page, not an empty screen. */
function resolvePage(requested: number | undefined, total: number): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { page: Math.min(Math.max(1, Math.floor(requested ?? 1)), pageCount), pageCount };
}

export async function listProducts(params: {
  tenantId: string;
  storeId: string;
  query?: string;
  page?: number;
}): Promise<Page<ProductRow>> {
  const where = buildProductWhere(params.tenantId, params.query ?? "");
  const total = await db.product.count({ where });
  const { page, pageCount } = resolvePage(params.page, total);

  const products = await db.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      category: true,
      brand: true,
      imageUrl: true,
      isActive: true,
      variants: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          size: true,
          colour: true,
          priceMinor: true,
          mrpMinor: true,
          isActive: true,
          // Store-scoped, so one store's count never appears on another's screen.
          stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
        },
        orderBy: { sku: "asc" },
      },
    },
    orderBy: [{ name: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const rows: ProductRow[] = products.map((product) => {
    const variants: ProductVariantRow[] = product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      size: variant.size,
      colour: variant.colour,
      priceMinor: variant.priceMinor,
      mrpMinor: variant.mrpMinor,
      isActive: variant.isActive,
      stockQuantity: variant.stockLevels[0]?.quantity ?? null,
    }));

    const prices = variants.map((v) => v.priceMinor);
    const counted = variants.filter((v) => v.stockQuantity !== null);

    return {
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      variantCount: variants.length,
      priceFromMinor: prices.length > 0 ? Math.min(...prices) : null,
      priceToMinor: prices.length > 0 ? Math.max(...prices) : null,
      // Null when nothing has been counted, rather than a zero that would read as "none in
      // stock" when the truth is "never counted here".
      stockQuantity:
        counted.length > 0 ? counted.reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0) : null,
      variants,
    };
  });

  return { rows, total, page, pageCount };
}

export interface InventoryRow {
  variantId: string;
  productName: string;
  category: string | null;
  brand: string | null;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  /** Null when this variant has never been counted in this store. */
  quantity: number | null;
  updatedAt: Date | null;
}

/**
 * One page of variants with this store's operational count.
 *
 * Driven from `ProductVariant` rather than from `StockLevel` on purpose: a variant that has
 * never been counted must still appear, as "not counted". Listing stock rows instead would
 * silently hide exactly the items someone opening this screen is looking for.
 */
export async function listInventory(params: {
  tenantId: string;
  storeId: string;
  query?: string;
  page?: number;
}): Promise<Page<InventoryRow>> {
  const trimmed = (params.query ?? "").trim();
  const where = {
    tenantId: params.tenantId,
    ...(trimmed.length === 0
      ? {}
      : {
          OR: [
            { sku: { contains: trimmed, mode: "insensitive" as const } },
            { barcode: trimmed },
            { product: { name: { contains: trimmed, mode: "insensitive" as const } } },
          ],
        }),
  };

  const total = await db.productVariant.count({ where });
  const { page, pageCount } = resolvePage(params.page, total);

  const variants = await db.productVariant.findMany({
    where,
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      priceMinor: true,
      product: { select: { name: true, category: true, brand: true, imageUrl: true } },
      stockLevels: {
        where: { storeId: params.storeId },
        select: { quantity: true, updatedAt: true },
      },
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return {
    rows: variants.map((variant) => ({
      variantId: variant.id,
      productName: variant.product.name,
      category: variant.product.category,
      brand: variant.product.brand,
      imageUrl: variant.product.imageUrl,
      sku: variant.sku,
      barcode: variant.barcode,
      size: variant.size,
      colour: variant.colour,
      priceMinor: variant.priceMinor,
      quantity: variant.stockLevels[0]?.quantity ?? null,
      updatedAt: variant.stockLevels[0]?.updatedAt ?? null,
    })),
    total,
    page,
    pageCount,
  };
}

export interface CatalogSummary {
  products: number;
  variants: number;
  /** Variants with a counted row in this store. */
  counted: number;
  /** Total units on hand across counted variants. Can be negative Ã¢â‚¬â€ see ADR-080. */
  unitsOnHand: number;
  outOfStock: number;
  oversold: number;
}

/**
 * Headline figures for the Inventory workspace.
 *
 * Note what is missing: stock *value*. `ProductVariant` has a selling price but no cost
 * price, and valuing inventory at retail would be a different Ã¢â‚¬â€ and wrong Ã¢â‚¬â€ number from the
 * one an accountant means by "stock value".
 */
export async function getCatalogSummary(params: {
  tenantId: string;
  storeId: string;
}): Promise<CatalogSummary> {
  const [products, variants, counted, unitsAggregate, outOfStock, oversold] = await Promise.all([
    db.product.count({ where: { tenantId: params.tenantId } }),
    db.productVariant.count({ where: { tenantId: params.tenantId } }),
    db.stockLevel.count({ where: { storeId: params.storeId } }),
    db.stockLevel.aggregate({ where: { storeId: params.storeId }, _sum: { quantity: true } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: 0 } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: { lt: 0 } } }),
  ]);

  return {
    products,
    variants,
    counted,
    unitsOnHand: unitsAggregate._sum.quantity ?? 0,
    outOfStock,
    oversold,
  };
}



export async function getProduct(params: { tenantId: string; productId: string }) {
  const product = await db.product.findUnique({
    where: { id_tenantId: { id: params.productId, tenantId: params.tenantId } },
    include: {
      variants: {
        orderBy: { sku: "asc" },
      },
      baseUom: true,
    }
  });
  return product;
}
export async function getVariant(opts: {
  tenantId: string;
  variantId: string;
}) {
  return await db.productVariant.findUnique({
    where: { id_tenantId: { id: opts.variantId, tenantId: opts.tenantId } },
  });
}
