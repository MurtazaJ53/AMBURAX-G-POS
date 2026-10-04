import { db } from "@/server/db";

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
    where: { tenantId, storeId, quantity: { gt: 10 } },
  });

  const lowStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { gt: 0, lte: 10 } },
  });
  
  const outOfStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { lte: 0 } },
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

  return { totalItems, totalUnits, inStock, lowStock, outOfStock, recentMovements, stockByCategory };
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

export async function getInventoryFilterOptions(params: { tenantId: string }) {
  const { tenantId } = params;

  const [categoryData, brandData] = await Promise.all([
    db.product.findMany({
      where: { tenantId, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
    db.product.findMany({
      where: { tenantId, brand: { not: null } },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    }),
  ]);

  const categories = categoryData.map(c => c.category).filter((c): c is string => c !== null);
  const brands = brandData.map(b => b.brand).filter((b): b is string => b !== null);

  return { categories, brands };
}
