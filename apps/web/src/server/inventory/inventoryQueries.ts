import { db } from "@/server/db";

/**
 * The operational low-stock rule: a stock level holding 1..LOW_STOCK_MAX_UNITS units is "low".
 *
 * A single store-wide number, not a per-product reorder level — the schema has no reorder
 * field, so nothing may describe this as a reorder point or a forecast. Exported so that the
 * overview's counts and the label that explains them ("Low (≤ 10 units)") read one value and
 * cannot drift apart.
 */
export const LOW_STOCK_MAX_UNITS = 10;

export async function getInventoryOverview(params: { tenantId: string; storeId: string }) {
  const { tenantId, storeId } = params;
  
  const totalItems = await db.stockLevel.count({
    where: { tenantId, storeId },
  });

  const aggregates = await db.stockLevel.aggregate({
    where: { tenantId, storeId, quantity: { gt: 0 } },
    _sum: { quantity: true },
  });
  const totalUnits = aggregates._sum.quantity || 0;
  
  const inStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { gt: LOW_STOCK_MAX_UNITS } },
  });

  const lowStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { gt: 0, lte: LOW_STOCK_MAX_UNITS } },
  });

  const outOfStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { lte: 0 } },
  });

  // The oversold subset of `outOfStock`: a balance below zero means more was sold than was
  // recorded on hand. Reported alongside `outOfStock`, never subtracted from it — the two are
  // nested, not exclusive, so subtracting would make "out of stock" stop meaning "cannot sell".
  const oversold = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { lt: 0 } },
  });
  
  // Recent movements in last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentMovements = await db.stockMovement.count({
    where: { tenantId, storeId, occurredAt: { gte: weekAgo } },
  });

  // Get category distribution for analytics (in memory aggregation)
  const stockWithCategories = await db.stockLevel.findMany({
    where: { tenantId, storeId, quantity: { gt: 0 } },
    select: {
      quantity: true,
      variant: {
        select: {
          product: {
            select: { category: true }
          }
        }
      }
    }
  });

  const categoryMap = new Map<string, number>();
  for (const item of stockWithCategories) {
    const cat = item.variant.product.category || "Uncategorized";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.quantity);
  }

  const stockByCategory = Array.from(categoryMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // top 5

  // Every category holding positive stock, before the top-5 cut above. Taken from the same map
  // in the same scope, so "Other (N categories)" counts exactly the categories whose units make
  // up the remainder — a count from a wider scope (zero-stock categories, say) would name
  // categories that contribute nothing to the share beside it.
  const categoryCount = categoryMap.size;

  return {
    totalItems,
    totalUnits,
    inStock,
    lowStock,
    outOfStock,
    recentMovements,
    stockByCategory,
    oversold,
    categoryCount,
  };
}

export async function listStockLevels(params: {
  tenantId: string;
  storeId: string;
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
  limit?: number;
  offset?: number;
}) {
  const { tenantId, storeId, search, status, category, brand, limit = 50, offset = 0 } = params;

  let quantityFilter: any = undefined;
  if (status === "in_stock") quantityFilter = { gt: 0 };
  else if (status === "low_stock") quantityFilter = { gt: 0, lte: 10 };
  else if (status === "out_of_stock") quantityFilter = { lte: 0 };

  const productConditions: any[] = [];
  
  if (search) {
    productConditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { variants: { some: { sku: { contains: search, mode: "insensitive" } } } }
      ]
    });
  }
  
  if (category) {
    productConditions.push({ category });
  }

  if (brand) {
    productConditions.push({ brand });
  }

  let productFilter: any = undefined;
  if (productConditions.length > 0) {
    productFilter = { AND: productConditions };
  }

  const where = {
    tenantId,
    storeId,
    ...(quantityFilter ? { quantity: quantityFilter } : {}),
    ...(productFilter ? { variant: { product: productFilter } } : {})
  };

  const [items, total] = await Promise.all([
    db.stockLevel.findMany({
      where,
      include: {
        variant: {
          include: {
            product: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.stockLevel.count({ where })
  ]);

  return { items, total };
}

export async function listStoreStockMovements(params: {
  tenantId: string;
  storeId: string;
  search?: string;
  type?: string;
  limit?: number;
  offset?: number;
}) {
  const { tenantId, storeId, search, type, limit = 50, offset = 0 } = params;

  let productFilter: any = undefined;
  if (search) {
    productFilter = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { variants: { some: { sku: { contains: search, mode: "insensitive" } } } }
      ]
    };
  }

  const where = {
    tenantId,
    storeId,
    ...(type ? { type: type as any } : {}),
    ...(productFilter ? { variant: { product: productFilter } } : {})
  };

  const [items, total] = await Promise.all([
    db.stockMovement.findMany({
      where,
      include: {
        variant: {
          include: {
            product: true
          }
        }
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    }),
    db.stockMovement.count({ where })
  ]);

  return { items, total };
}

export async function getInventoryFilterOptions(params: { tenantId: string; storeId: string }) {
  const { tenantId, storeId } = params;

  const [categoryData, brandData] = await Promise.all([
    db.product.findMany({
      where: {
        tenantId,
        category: { not: null },
        variants: {
          some: {
            stockLevels: {
              some: { storeId }
            }
          }
        }
      },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
    db.product.findMany({
      where: {
        tenantId,
        brand: { not: null },
        variants: {
          some: {
            stockLevels: {
              some: { storeId }
            }
          }
        }
      },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    }),
  ]);

  const categories = categoryData.map(c => c.category).filter((c): c is string => c !== null);
  const brands = brandData.map(b => b.brand).filter((b): b is string => b !== null);

  return { categories, brands };
}
