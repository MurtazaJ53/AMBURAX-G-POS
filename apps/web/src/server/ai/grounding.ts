import { db } from "@/server/db";
import { startOfStoreDay } from "@/server/dashboard/dashboardQueries";

/**
 * Real-time business signals grounded in database facts.
 * AI uses ONLY these facts; never invents figures or hallucinated numbers.
 */

export interface BusinessGrounding {
  storeName: string;
  tradingDay: string;
  todaySales: {
    totalMinor: number;
    billCount: number;
    itemsSold: number;
    avgBillMinor: number | null;
  };
  yesterdaySales: {
    totalMinor: number;
    billCount: number;
  };
  inventoryAlerts: {
    lowStockCount: number;
    outOfStockCount: number;
    criticalItems: { name: string; sku: string; qty: number; minQty: number }[];
  };
  khataDueAlerts: {
    totalOutstandingMinor: number;
    overdueCount: number;
    topDebtors: { name: string; phone: string | null; dueMinor: number; daysPending: number }[];
  };
  purchasingAlerts: {
    recentBillsCount: number;
  };
}

export async function gatherBusinessGrounding(input: {
  tenantId: string;
  storeId: string;
}): Promise<BusinessGrounding> {
  const store = await db.store.findFirst({
    where: { id: input.storeId, tenantId: input.tenantId },
    select: { name: true },
  });

  const now = new Date();
  const todayStart = startOfStoreDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  // Today sales
  const todaySales = await db.sale.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      status: "COMPLETED",
      completedAt: { gte: todayStart },
    },
    select: { totalMinor: true, items: { select: { quantity: true } } },
  });

  const todayTotal = todaySales.reduce((acc, s) => acc + s.totalMinor, 0);
  const todayItems = todaySales.reduce((acc, s) => acc + s.items.reduce((iacc, it) => iacc + it.quantity, 0), 0);
  const todayBills = todaySales.length;

  // Yesterday sales
  const yesterdaySales = await db.sale.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      status: "COMPLETED",
      completedAt: { gte: yesterdayStart, lt: todayStart },
    },
    select: { totalMinor: true },
  });

  const yesterdayTotal = yesterdaySales.reduce((acc, s) => acc + s.totalMinor, 0);

  // Stock alerts
  const stockRows = await db.stockLevel.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      quantity: { lte: 5 },
    },
    include: {
      variant: {
        include: {
          product: { select: { name: true } },
        },
      },
    },
    orderBy: { quantity: "asc" },
    take: 10,
  });

  const outOfStockCount = stockRows.filter((s) => s.quantity <= 0).length;
  const lowStockCount = stockRows.filter((s) => s.quantity > 0 && s.quantity <= 5).length;
  const criticalItems = stockRows.slice(0, 5).map((s) => ({
    name: s.variant.product.name,
    sku: s.variant.sku,
    qty: s.quantity,
    minQty: 5,
  }));

  // Khata dues
  const salesWithCredit = await db.sale.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      status: "COMPLETED",
      initialOnAccountMinor: { gt: 0 },
      customerId: { not: null },
    },
    select: {
      customerId: true,
      initialOnAccountMinor: true,
      paidMinor: true,
      totalMinor: true,
      completedAt: true,
    },
    take: 30,
    orderBy: { completedAt: "asc" },
  });

  const customerIds = Array.from(new Set(salesWithCredit.map((s) => s.customerId).filter(Boolean))) as string[];
  const customers = customerIds.length > 0
    ? await db.customer.findMany({
        where: { id: { in: customerIds }, tenantId: input.tenantId },
        select: { id: true, name: true, phone: true },
      })
    : [];

  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const debtorsMap = new Map<string, { name: string; phone: string | null; dueMinor: number; daysPending: number }>();
  let totalDueMinor = 0;

  for (const s of salesWithCredit) {
    if (!s.customerId) continue;
    const cust = customerMap.get(s.customerId);
    const name = cust?.name ?? "Customer";
    const phone = cust?.phone ?? null;
    const due = Math.max(0, s.initialOnAccountMinor);
    totalDueMinor += due;

    const days = Math.floor((now.getTime() - s.completedAt.getTime()) / (1000 * 60 * 60 * 24));
    const existing = debtorsMap.get(s.customerId);
    if (existing) {
      existing.dueMinor += due;
      existing.daysPending = Math.max(existing.daysPending, days);
    } else {
      debtorsMap.set(s.customerId, { name, phone, dueMinor: due, daysPending: days });
    }
  }

  const topDebtors = Array.from(debtorsMap.values())
    .sort((a, b) => b.dueMinor - a.dueMinor)
    .slice(0, 5);

  return {
    storeName: store?.name ?? "Store",
    tradingDay: now.toISOString().slice(0, 10),
    todaySales: {
      totalMinor: todayTotal,
      billCount: todayBills,
      itemsSold: todayItems,
      avgBillMinor: todayBills > 0 ? Math.round(todayTotal / todayBills) : null,
    },
    yesterdaySales: {
      totalMinor: yesterdayTotal,
      billCount: yesterdaySales.length,
    },
    inventoryAlerts: {
      lowStockCount,
      outOfStockCount,
      criticalItems,
    },
    khataDueAlerts: {
      totalOutstandingMinor: totalDueMinor,
      overdueCount: topDebtors.filter((d) => d.daysPending > 15).length,
      topDebtors,
    },
    purchasingAlerts: {
      recentBillsCount: 0,
    },
  };
}
