import { db } from "@/server/db";

export const TOP_CUSTOMER_WINDOWS = [30, 90, 180, 365] as const;
export type TopCustomerWindow = (typeof TOP_CUSTOMER_WINDOWS)[number];

export function isTopCustomerWindow(n: number): n is TopCustomerWindow {
  return (TOP_CUSTOMER_WINDOWS as readonly number[]).includes(n);
}

export interface TopCustomerRow {
  rank: number;
  id: string;
  name: string;
  phone: string | null;
  customerType: string;
  totalSpentMinor: number;
  totalBills: number;
  avgBasketMinor: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  creditLimitMinor: number | null;
}

export interface TopCustomersSummary {
  windowDays: TopCustomerWindow;
  metric: "spend" | "visits";
  totalAttributedRevenueMinor: number;
  totalAttributedBills: number;
  totalActiveCustomers: number;
  rows: TopCustomerRow[];
}

export async function getTopCustomers(params: {
  tenantId: string;
  days: TopCustomerWindow;
  metric?: "spend" | "visits";
  limit?: number;
}): Promise<TopCustomersSummary> {
  const metric = params.metric ?? "spend";
  const limit = Math.min(params.limit ?? 50, 100);
  const since = new Date(Date.now() - params.days * 86_400_000);

  // Aggregation of completed sales within time window
  const rawRows = await db.$queryRaw<
    {
      id: string;
      name: string;
      phone: string | null;
      customerType: string;
      creditLimitMinor: number | null;
      firstPurchaseAt: Date | null;
      lastPurchaseAt: Date | null;
      windowBills: bigint;
      windowSpentMinor: bigint;
    }[]
  >`
    SELECT c."id", c."name", c."phone", c."customerType"::text AS "customerType", c."creditLimitMinor",
           agg."firstPurchaseAt", agg."lastPurchaseAt",
           COALESCE(agg."windowBills", 0) AS "windowBills",
           COALESCE(agg."windowSpentMinor", 0) AS "windowSpentMinor"
      FROM "customers" c
      INNER JOIN (
        SELECT s."customerId",
               MIN(s."completedAt") AS "firstPurchaseAt",
               MAX(s."completedAt") AS "lastPurchaseAt",
               COUNT(*) FILTER (WHERE s."completedAt" >= ${since}) AS "windowBills",
               SUM(s."totalMinor") FILTER (WHERE s."completedAt" >= ${since}) AS "windowSpentMinor"
          FROM "sales" s
         WHERE s."tenantId" = ${params.tenantId}
           AND s."status" = 'COMPLETED'
           AND s."customerId" IS NOT NULL
         GROUP BY s."customerId"
      ) agg ON agg."customerId" = c."id"
     WHERE c."tenantId" = ${params.tenantId}
       AND c."isActive" = TRUE
       AND agg."windowBills" > 0
  `;

  // Sort by metric
  const sorted = rawRows.sort((a, b) => {
    const aSpent = Number(a.windowSpentMinor);
    const bSpent = Number(b.windowSpentMinor);
    const aBills = Number(a.windowBills);
    const bBills = Number(a.windowBills);

    if (metric === "visits") {
      return bBills - aBills || bSpent - aSpent;
    }
    return bSpent - aSpent || bBills - aBills;
  });

  const totalAttributedRevenueMinor = rawRows.reduce((acc, r) => acc + Number(r.windowSpentMinor), 0);
  const totalAttributedBills = rawRows.reduce((acc, r) => acc + Number(r.windowBills), 0);
  const totalActiveCustomers = rawRows.length;

  const rows: TopCustomerRow[] = sorted.slice(0, limit).map((r, idx) => {
    const totalSpentMinor = Number(r.windowSpentMinor);
    const totalBills = Number(r.windowBills);
    const avgBasketMinor = totalBills > 0 ? Math.round(totalSpentMinor / totalBills) : 0;

    return {
      rank: idx + 1,
      id: r.id,
      name: r.name,
      phone: r.phone,
      customerType: r.customerType,
      totalSpentMinor,
      totalBills,
      avgBasketMinor,
      firstPurchaseAt: r.firstPurchaseAt,
      lastPurchaseAt: r.lastPurchaseAt,
      creditLimitMinor: r.creditLimitMinor,
    };
  });

  return {
    windowDays: params.days,
    metric,
    totalAttributedRevenueMinor,
    totalAttributedBills,
    totalActiveCustomers,
    rows,
  };
}
