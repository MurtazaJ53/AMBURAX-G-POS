import { db } from "@/server/db";

export async function getInventoryOverview(params: { tenantId: string; storeId: string }) {
  const { tenantId, storeId } = params;
  
  const totalItems = await db.stockLevel.count({
    where: { tenantId, storeId },
  });
  
  const inStock = await db.stockLevel.count({
    where: { tenantId, storeId, quantity: { gt: 0 } },
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

  return { totalItems, inStock, outOfStock, recentMovements };
}

export async function listStockLevels(params: {
  tenantId: string;
  storeId: string;
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const { tenantId, storeId, search, status, limit = 50, offset = 0 } = params;

  let quantityFilter: any = undefined;
  if (status === "in_stock") quantityFilter = { gt: 0 };
  else if (status === "out_of_stock") quantityFilter = { lte: 0 };

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
