import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { stockStatusOf, type CatalogFilters, type SortOption } from "./catalogFilters";

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

/**
 * The workspace filters, as a Prisma `where`.
 *
 * Built by AND-ing one clause per active filter, so two filters narrow while two values
 * within one filter widen — which is what a shopkeeper means by ticking "Shirts" and
 * "Trousers" and then also ticking a brand.
 *
 * Size, colour and price all describe *variants*, not products, so each becomes a `some`
 * clause. That has a consequence worth stating: a product matches a size filter if any of its
 * variants is that size, and the grid then shows the whole product. It is the only honest
 * reading — the catalogue's unit is the product, and hiding a product's other sizes because
 * one was filtered would misrepresent what is on the shelf.
 */
function buildCatalogWhere(tenantId: string, storeId: string, filters: CatalogFilters) {
  const clauses: Prisma.ProductWhereInput[] = [buildProductWhere(tenantId, filters.query)];

  if (filters.categories.length > 0) clauses.push({ category: { in: filters.categories } });
  if (filters.brands.length > 0) clauses.push({ brand: { in: filters.brands } });
  if (filters.sizes.length > 0) {
    clauses.push({ variants: { some: { size: { in: filters.sizes } } } });
  }
  if (filters.colours.length > 0) {
    clauses.push({ variants: { some: { colour: { in: filters.colours } } } });
  }

  if (filters.priceMinMinor !== null || filters.priceMaxMinor !== null) {
    clauses.push({
      variants: {
        some: {
          priceMinor: {
            ...(filters.priceMinMinor !== null ? { gte: filters.priceMinMinor } : {}),
            ...(filters.priceMaxMinor !== null ? { lte: filters.priceMaxMinor } : {}),
          },
        },
      },
    });
  }

  if (filters.stock.length > 0) {
    // Each state is expressed against this store's stock rows only, so a product counted in
    // another shop does not read as counted here.
    const countedHere = { stockLevels: { some: { storeId } } };
    const inStockHere = { stockLevels: { some: { storeId, quantity: { gt: 0 } } } };

    const stockClauses: Prisma.ProductWhereInput[] = filters.stock.map((status) => {
      if (status === "in") return { variants: { some: inStockHere } };
      if (status === "out") {
        // Counted here, but nothing on hand. Both halves are needed: without the first, a
        // product nobody has ever counted would report as out of stock.
        return {
          AND: [{ variants: { some: countedHere } }, { variants: { none: inStockHere } }],
        };
      }
      return { variants: { none: countedHere } };
    });

    clauses.push({ OR: stockClauses });
  }

  return { AND: clauses };
}

/** Sorts Postgres can order directly. Price is aggregated per product and handled apart. */
function buildOrderBy(sort: SortOption): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "name_desc":
      return [{ name: "desc" }];
    case "newest":
      return [{ createdAt: "desc" }, { name: "asc" }];
    case "oldest":
      return [{ createdAt: "asc" }, { name: "asc" }];
    default:
      return [{ name: "asc" }];
  }
}

/** Clamp a requested page so `?page=999` lands on the last page, not an empty screen. */
function resolvePage(requested: number | undefined, total: number): { page: number; pageCount: number } {
  return resolvePageOf(requested, total, PAGE_SIZE);
}

function resolvePageOf(
  requested: number | undefined,
  total: number,
  pageSize: number,
): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, Math.floor(requested ?? 1)), pageCount), pageCount };
}

/**
 * A page of the catalogue.
 *
 * `filters` is the workspace's full state; `query`/`page` remain for the callers that only
 * ever wanted a search box. When both are given, `filters` wins.
 *
 * Price sorting is the one case that cannot be expressed as an `orderBy`: a product has no
 * price of its own, only the range across its variants. Rather than sort by something
 * convenient and wrong — the first variant, say — the matching ids are aggregated and ordered
 * before the page is cut. That costs one extra pass over the tenant's matching ids, which is
 * correct at the scale a single business's catalogue reaches and would want revisiting at
 * hundreds of thousands of products.
 */
export async function listProducts(params: {
  tenantId: string;
  storeId: string;
  query?: string;
  page?: number;
  filters?: CatalogFilters;
  pageSize?: number;
}): Promise<Page<ProductRow>> {
  const filters = params.filters;
  const pageSize = Math.max(1, params.pageSize ?? PAGE_SIZE);

  const where = filters
    ? buildCatalogWhere(params.tenantId, params.storeId, filters)
    : buildProductWhere(params.tenantId, params.query ?? "");

  const total = await db.product.count({ where });
  const { page, pageCount } = resolvePageOf(params.filters?.page ?? params.page, total, pageSize);

  const sort: SortOption = filters?.sort ?? "name";
  const byPrice = sort === "price_asc" || sort === "price_desc";

  let orderedIds: string[] | null = null;
  if (byPrice) {
    const matching = await db.product.findMany({ where, select: { id: true } });
    const ids = matching.map((row) => row.id);

    const grouped =
      ids.length > 0
        ? await db.productVariant.groupBy({
            by: ["productId"],
            where: { productId: { in: ids } },
            _min: { priceMinor: true },
          })
        : [];

    const minPrice = new Map(grouped.map((row) => [row.productId, row._min.priceMinor]));
    orderedIds = ids
      .slice()
      .sort((a, b) => {
        const left = minPrice.get(a);
        const right = minPrice.get(b);
        // A product with no variants has no price. It sorts last either way rather than
        // pretending to be free.
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return sort === "price_asc" ? left - right : right - left;
      })
      .slice((page - 1) * pageSize, page * pageSize);
  }

  const products = await db.product.findMany({
    where: orderedIds ? { AND: [where, { id: { in: orderedIds } }] } : where,
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
    orderBy: buildOrderBy(sort),
    ...(orderedIds ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
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

export interface CatalogFacets {
  categories: { value: string; count: number }[];
  brands: { value: string; count: number }[];
  sizes: string[];
  colours: string[];
  /** Cheapest and dearest variant in the catalogue, in minor units. Null when nothing priced. */
  priceFloorMinor: number | null;
  priceCeilingMinor: number | null;
  stock: { in: number; out: number; uncounted: number };
}

/**
 * The filter panel's options, counted from this tenant's own rows.
 *
 * The design reference prints a count beside every option — "Men's Wear (428)" — and those
 * numbers are the whole reason this query exists rather than a hardcoded list. A count that
 * does not match what clicking it returns is worse than no count at all.
 *
 * Counts describe the *whole* catalogue, not the current filter. That is the reference's
 * behaviour and the more useful one: a count that shrank as you filtered would leave a
 * shopkeeper unable to see what else is available to widen to.
 */
export async function getCatalogFacets(params: {
  tenantId: string;
  storeId: string;
}): Promise<CatalogFacets> {
  const { tenantId, storeId } = params;
  const countedHere = { stockLevels: { some: { storeId } } };
  const inStockHere = { stockLevels: { some: { storeId, quantity: { gt: 0 } } } };

  const [categories, brands, variantFacets, priceBounds, inCount, outCount, uncountedCount] =
    await Promise.all([
      db.product.groupBy({
        by: ["category"],
        where: { tenantId, category: { not: null } },
        _count: { _all: true },
        orderBy: { category: "asc" },
      }),
      db.product.groupBy({
        by: ["brand"],
        where: { tenantId, brand: { not: null } },
        _count: { _all: true },
        orderBy: { brand: "asc" },
      }),
      db.productVariant.findMany({
        where: { tenantId },
        select: { size: true, colour: true },
        distinct: ["size", "colour"],
      }),
      db.productVariant.aggregate({
        where: { tenantId },
        _min: { priceMinor: true },
        _max: { priceMinor: true },
      }),
      db.product.count({ where: { tenantId, variants: { some: inStockHere } } }),
      db.product.count({
        where: {
          tenantId,
          AND: [{ variants: { some: countedHere } }, { variants: { none: inStockHere } }],
        },
      }),
      db.product.count({ where: { tenantId, variants: { none: countedHere } } }),
    ]);

  // Sizes sort naturally rather than alphabetically: S, M, L, XL is the order a shopkeeper
  // reads, and "L, M, S, XL" looks like a bug even though it is correct alphabetically.
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
  const sizes = [...new Set(variantFacets.map((v) => v.size).filter((s): s is string => !!s))].sort(
    (a, b) => {
      const left = SIZE_ORDER.indexOf(a.toUpperCase());
      const right = SIZE_ORDER.indexOf(b.toUpperCase());
      if (left === -1 && right === -1) return a.localeCompare(b, undefined, { numeric: true });
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    },
  );

  const colours = [
    ...new Set(variantFacets.map((v) => v.colour).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    categories: categories
      .filter((row) => row.category)
      .map((row) => ({ value: row.category as string, count: row._count._all })),
    brands: brands
      .filter((row) => row.brand)
      .map((row) => ({ value: row.brand as string, count: row._count._all })),
    sizes,
    colours,
    priceFloorMinor: priceBounds._min.priceMinor,
    priceCeilingMinor: priceBounds._max.priceMinor,
    stock: { in: inCount, out: outCount, uncounted: uncountedCount },
  };
}

export interface ProductStoreStock {
  storeId: string;
  storeName: string;
  storeCode: string;
  quantity: number;
}

export interface ProductSalesSummary {
  /** Units sold across the window, this tenant, all stores. */
  unitsSold: number;
  revenueMinor: number;
  windowDays: number;
  lastSoldAt: Date | null;
}

export interface ProductDetail {
  product: ProductRow;
  /** Every store that has counted this product, not only the active one. */
  storeStock: ProductStoreStock[];
  /** Null when the tenant has no sale lines for this product at all. */
  sales: ProductSalesSummary | null;
  createdAt: Date;
  updatedAt: Date;
  baseUomCode: string | null;
}

const SALES_WINDOW_DAYS = 30;

/**
 * Everything the detail panel shows, for one product.
 *
 * Three reads, because the panel spans three domains and none of them should be reinvented
 * here: the catalogue owns the product and its variants, inventory owns the per-store counts
 * (ADR-080 — an operational projection, never an accounting ledger), and sales owns what
 * actually sold. Stock is deliberately *not* filtered to the active store, because the
 * reference's "Current Stock (All Stores)" is the genuinely useful figure when deciding
 * whether to transfer rather than reorder.
 */
export async function getProductDetail(params: {
  tenantId: string;
  storeId: string;
  productId: string;
}): Promise<ProductDetail | null> {
  const { tenantId, productId } = params;

  const product = await db.product.findUnique({
    where: { id_tenantId: { id: productId, tenantId } },
    select: {
      id: true,
      name: true,
      category: true,
      brand: true,
      imageUrl: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      baseUom: { select: { code: true } },
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
          stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
        },
        orderBy: { sku: "asc" },
      },
    },
  });

  if (!product) return null;

  const since = new Date(Date.now() - SALES_WINDOW_DAYS * 86_400_000);

  const [stockRows, salesAggregate, lastSale] = await Promise.all([
    db.stockLevel.findMany({
      where: { tenantId, variant: { productId } },
      select: {
        quantity: true,
        store: { select: { id: true, name: true, code: true } },
      },
    }),
    db.saleItem.aggregate({
      where: {
        tenantId,
        variant: { productId },
        sale: { tenantId, status: "COMPLETED", completedAt: { gte: since } },
      },
      _sum: { quantity: true, lineTotalMinor: true },
    }),
    db.saleItem.findFirst({
      where: { tenantId, variant: { productId }, sale: { tenantId, status: "COMPLETED" } },
      select: { sale: { select: { completedAt: true } } },
      orderBy: { sale: { completedAt: "desc" } },
    }),
  ]);

  // One row per store, summed across the product's variants.
  const byStore = new Map<string, ProductStoreStock>();
  for (const row of stockRows) {
    const existing = byStore.get(row.store.id);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      byStore.set(row.store.id, {
        storeId: row.store.id,
        storeName: row.store.name,
        storeCode: row.store.code,
        quantity: row.quantity,
      });
    }
  }

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
  const unitsSold = salesAggregate._sum.quantity ?? 0;

  return {
    product: {
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      variantCount: variants.length,
      priceFromMinor: prices.length > 0 ? Math.min(...prices) : null,
      priceToMinor: prices.length > 0 ? Math.max(...prices) : null,
      stockQuantity:
        counted.length > 0 ? counted.reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0) : null,
      variants,
    },
    storeStock: [...byStore.values()].sort((a, b) => a.storeName.localeCompare(b.storeName)),
    // Null rather than a row of zeroes when this product has never sold: "nothing in 30 days"
    // and "never sold" are different facts, and the panel says which one it is.
    sales:
      lastSale === null
        ? null
        : {
            unitsSold,
            revenueMinor: salesAggregate._sum.lineTotalMinor ?? 0,
            windowDays: SALES_WINDOW_DAYS,
            lastSoldAt: lastSale.sale.completedAt,
          },
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    baseUomCode: product.baseUom?.code ?? null,
  };
}

/** Re-exported so components can read stock state without importing two modules. */
export { stockStatusOf };
