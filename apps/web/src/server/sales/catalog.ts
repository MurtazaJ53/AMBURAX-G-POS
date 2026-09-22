import { db } from "@/server/db";

/**
 * Catalog and stock reads for the counter.
 *
 * Every query here takes `tenantId` from the caller's resolved session and scopes on it.
 * There is no parameter a client could use to reach another tenant's catalogue, and the
 * absence of a tenant scope on any query in this file would be a cross-tenant data leak.
 */

export interface CatalogHit {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  taxRateBp: number;
  /**
   * AMBURAX operational projection, not a confirmed ledger figure (ADR-080). Null when the
   * variant has never been counted in this store — genuinely different from zero, and not
   * to be rendered as "0 in stock".
   */
  stockQuantity: number | null;
}

export const CATALOG_SEARCH_LIMIT = 30;

/**
 * Search a tenant's sellable variants.
 *
 * An exact barcode match short-circuits: at a counter a scan must land on one item
 * immediately, rather than returning a list the operator then has to disambiguate. Only
 * when there is no barcode hit does it fall back to a name/SKU contains-match.
 */
export async function searchCatalog(params: {
  tenantId: string;
  storeId: string;
  query: string;
  limit?: number;
}): Promise<CatalogHit[]> {
  const query = params.query.trim();
  const take = Math.min(params.limit ?? CATALOG_SEARCH_LIMIT, CATALOG_SEARCH_LIMIT);

  const variants = await db.productVariant.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      product: { isActive: true },
      ...(query.length === 0
        ? {}
        : {
            OR: [
              { barcode: query },
              { sku: { contains: query, mode: "insensitive" as const } },
              { product: { name: { contains: query, mode: "insensitive" as const } } },
            ],
          }),
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      priceMinor: true,
      taxRateBp: true,
      product: { select: { name: true, imageUrl: true } },
      // Store-scoped so one store's count never appears on another's screen.
      stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    take,
  });

  const exactBarcode = query.length > 0 ? variants.filter((v) => v.barcode === query) : [];
  const rows = exactBarcode.length > 0 ? exactBarcode : variants;

  return rows.map((v) => ({
    variantId: v.id,
    productName: v.product.name,
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    colour: v.colour,
    priceMinor: v.priceMinor,
    taxRateBp: v.taxRateBp,
    stockQuantity: v.stockLevels[0]?.quantity ?? null,
  }));
}


/**
 * A scan: one barcode, one indexed read, one answer.
 *
 * Distinct from `searchCatalog` on purpose. That function serves a person typing, so it runs a
 * `contains` match across SKU and product name and only then prefers an exact barcode hit — which
 * is right for a search box and wrong for a scanner, where the query is known to be exact and the
 * till is waiting. This goes straight to the `(tenantId, barcode)` unique index.
 *
 * It also differs in what it hides. `searchCatalog` filters to active variants, which is correct
 * for browsing; but a cashier who scans a withdrawn item deserves "this item is not for sale"
 * rather than "unknown barcode", so an inactive variant is returned **with its flag** and the
 * refusal is left to `saleService`, which already enforces it.
 *
 * Returns null for an unknown barcode, and for another tenant's barcode — indistinguishable, as
 * everywhere else.
 */
export async function scanBarcode(params: {
  tenantId: string;
  storeId: string;
  barcode: string;
}): Promise<(CatalogHit & { isActive: boolean }) | null> {
  const barcode = params.barcode.trim();
  if (barcode.length === 0) return null;

  const variant = await db.productVariant.findFirst({
    where: { tenantId: params.tenantId, barcode },
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      priceMinor: true,
      taxRateBp: true,
      isActive: true,
      product: { select: { name: true, isActive: true } },
      stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
    },
  });
  if (!variant) return null;

  return {
    variantId: variant.id,
    productName: variant.product.name,
    sku: variant.sku,
    barcode: variant.barcode,
    size: variant.size,
    colour: variant.colour,
    priceMinor: variant.priceMinor,
    taxRateBp: variant.taxRateBp,
    stockQuantity: variant.stockLevels[0]?.quantity ?? null,
    // A withdrawn product makes its variants unsellable too, so both flags fold into one answer.
    isActive: variant.isActive && variant.product.isActive,
  };
}
