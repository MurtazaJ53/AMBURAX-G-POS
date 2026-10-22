import { db } from "@/server/db";
import { notDraftProductWhere } from "@/server/catalog/draftFilter";

/**
 * Catalog and stock reads for the counter.
 *
 * Every query here takes `tenantId` from the caller's resolved session and scopes on it.
 * There is no parameter a client could use to reach another tenant's catalogue, and the
 * absence of a tenant scope on any query in this file would be a cross-tenant data leak.
 */

export interface PendingPriceOption {
  id: string;
  priceMinor: number;
  mrpMinor: number | null;
  unitsAhead: number;
  oldStockRemaining?: number;
  newStockRemaining?: number;
}

export interface CatalogHit {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor: number | null;
  taxRateBp: number;
  taxRateMode: "FIXED" | "APPAREL_SLAB";
  taxTreatment: string;
  /**
   * AMBURAX operational projection, not a confirmed ledger figure (ADR-080). Null when the
   * variant has never been counted in this store — genuinely different from zero, and not
   * to be rendered as "0 in stock".
   */
  stockQuantity: number | null;
  imageUrl?: string | null;
  pendingPrices?: PendingPriceOption[];
}

export const CATALOG_SEARCH_LIMIT = 30;

export interface CatalogFilters {
  category?: string;
  brand?: string;
  size?: string;
  colour?: string;
  /** Inclusive price bounds in minor units (paise). */
  minPriceMinor?: number;
  maxPriceMinor?: number;
}

/** Text filters match whole values, ignoring case — the same values the facet lists show. */
const eq = (value: string) => ({ equals: value, mode: "insensitive" as const });

/**
 * One page of the till's catalogue: the typed query and the filters together, `limit` at a time
 * from `offset`. `hasMore` comes from reading one row past the page, so the screen can offer
 * "Load more" without a separate count over a large catalogue.
 */
export async function searchCatalogPage(params: {
  tenantId: string;
  storeId: string;
  query: string;
  filters?: CatalogFilters;
  limit?: number;
  offset?: number;
}): Promise<{ results: CatalogHit[]; hasMore: boolean }> {
  const query = params.query.trim();
  const take = Math.min(params.limit ?? CATALOG_SEARCH_LIMIT, CATALOG_SEARCH_LIMIT);
  const skip = Math.max(0, Math.floor(params.offset ?? 0));
  const f = params.filters ?? {};
  const product = {
    isActive: true,
    isDraft: false,
    ...(f.category ? { category: eq(f.category) } : {}),
    ...(f.brand ? { brand: eq(f.brand) } : {}),
  };
  const price =
    f.minPriceMinor !== undefined || f.maxPriceMinor !== undefined
      ? { priceMinor: { ...(f.minPriceMinor !== undefined ? { gte: f.minPriceMinor } : {}), ...(f.maxPriceMinor !== undefined ? { lte: f.maxPriceMinor } : {}) } }
      : {};

  const variants = await db.productVariant.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      product,
      ...(f.size ? { size: eq(f.size) } : {}),
      ...(f.colour ? { colour: eq(f.colour) } : {}),
      ...price,
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
      mrpMinor: true,
      taxRateBp: true,
      taxRateMode: true,
      taxTreatment: true,
      product: { select: { name: true, imageUrl: true } },
      // Store-scoped so one store's count never appears on another's screen.
      stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    skip,
    take: take + 1,
  });
  const hasMore = variants.length > take;
  const page = hasMore ? variants.slice(0, take) : variants;

  const exactBarcode = query.length > 0 ? page.filter((v) => v.barcode === query) : [];
  const rows = exactBarcode.length > 0 ? exactBarcode : page;

  const results = rows.map((v) => ({
    variantId: v.id,
    productName: v.product.name,
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    colour: v.colour,
    priceMinor: v.priceMinor,
    mrpMinor: v.mrpMinor,
    taxRateBp: v.taxRateBp,
    taxRateMode: v.taxRateMode,
    taxTreatment: v.taxTreatment,
    stockQuantity: v.stockLevels[0]?.quantity ?? null,
    imageUrl: v.product.imageUrl ?? null,
  }));
  return { results, hasMore: exactBarcode.length > 0 ? false : hasMore };
}

/**
 * Search a tenant's sellable variants: the first page, no filters.
 *
 * An exact barcode match short-circuits: at a counter a scan must land on one item
 * immediately, rather than returning a list the operator then has to disambiguate. Only
 * when there is no barcode hit does it fall back to a name/SKU contains-match.
 */
export async function searchCatalog(params: { tenantId: string; storeId: string; query: string; limit?: number }): Promise<CatalogHit[]> {
  return (await searchCatalogPage(params)).results;
}

/**
 * A scan: one barcode, one indexed read, one answer.
 *
 * Distinct from `searchCatalog` on purpose. That function serves a person typing, so it runs a
 * `contains` match across SKU and product name and only then prefers an exact barcode hit — which
 * is right for a search box and wrong for a scanner, where the query is known to be exact and the
 * till is waiting. This goes straight to the `(tenantId, barcode)` unique index.
 *
 * It also checks if there are pending queued price changes (e.g. Solution B: collision items with
 * older stock at ₹799 and new stock at ₹899), providing the cashier with options if needed.
 */
export async function scanBarcode(params: {
  tenantId: string;
  storeId: string;
  barcode: string;
}): Promise<(CatalogHit & { isActive: boolean }) | null> {
  const barcode = params.barcode.trim();
  if (barcode.length === 0) return null;

  // 1. First look up the barcode in the new variant_barcodes table
  let matchedVariantId: string | null = null;
  const vb = await db.variantBarcode.findUnique({
    where: { tenantId_barcode: { tenantId: params.tenantId, barcode } },
    select: { variantId: true },
  });
  if (vb) {
    matchedVariantId = vb.variantId;
  }

  // 2. Fetch the variant (by matched ID or legacy barcode column fallback)
  const variant = await db.productVariant.findFirst({
    where: {
      ...(matchedVariantId
        ? { id: matchedVariantId, tenantId: params.tenantId }
        : { tenantId: params.tenantId, barcode }),
      product: { isDraft: false },
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      priceMinor: true,
      mrpMinor: true,
      taxRateBp: true,
      taxRateMode: true,
      taxTreatment: true,
      isActive: true,
      product: { select: { name: true, isActive: true, isDraft: true, imageUrl: true } },
      stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
    },
  });
  if (!variant) return null;

  const totalStock = variant.stockLevels[0]?.quantity ?? 0;

  // Check for pending active price changes where BOTH buckets have stock remaining:
  // oldStockRemaining = unitsAhead
  // newStockRemaining = max(0, totalStock - unitsAhead)
  // If either bucket hits 0, there is no collision! Auto-bill the remaining active batch.
  const pending = await db.pendingPriceChange.findMany({
    where: { tenantId: params.tenantId, variantId: variant.id, status: "PENDING", unitsAhead: { gt: 0 } },
    select: { id: true, newPriceMinor: true, newMrpMinor: true, unitsAhead: true },
    orderBy: { createdAt: "asc" },
  });

  const validPending = pending.filter((p) => {
    const oldStock = p.unitsAhead;
    const newStock = Math.max(0, totalStock - oldStock);
    // Only collide if both old stock and new stock are strictly > 0
    return oldStock > 0 && newStock > 0;
  });

  const pendingPrices: PendingPriceOption[] = validPending.map((p) => ({
    id: p.id,
    priceMinor: p.newPriceMinor,
    mrpMinor: p.newMrpMinor,
    unitsAhead: p.unitsAhead,
    oldStockRemaining: p.unitsAhead,
    newStockRemaining: Math.max(0, totalStock - p.unitsAhead),
  }));

  return {
    variantId: variant.id,
    productName: variant.product.name,
    sku: variant.sku,
    barcode: variant.barcode,
    size: variant.size,
    colour: variant.colour,
    priceMinor: variant.priceMinor,
    mrpMinor: variant.mrpMinor,
    taxRateBp: variant.taxRateBp,
    taxRateMode: variant.taxRateMode,
    taxTreatment: variant.taxTreatment,
    stockQuantity: variant.stockLevels[0]?.quantity ?? null,
    imageUrl: variant.product.imageUrl ?? null,
    pendingPrices: pendingPrices.length > 0 ? pendingPrices : undefined,
    // A withdrawn product makes its variants unsellable too, so both flags fold into one answer.
    isActive: variant.isActive && variant.product.isActive,
  };
}
