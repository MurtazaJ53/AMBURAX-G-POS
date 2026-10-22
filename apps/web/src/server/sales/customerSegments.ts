import { db } from "@/server/db";

/**
 * Customer segments (screen 40). What counts as a "top" or "lapsed" customer is the owner's call
 * (latter.md Q16, Q18), so no window is fixed here: the viewer picks one, and every segment is a
 * plain fact about that window —
 *
 *   new     first completed bill falls inside the window
 *   active  bought inside the window, first bill before it
 *   lapsed  has bought, but not inside the window
 *   never   no completed bill at all
 *
 * crossed with the three customer types the product already has.
 */

export const SEGMENT_WINDOWS = [30, 90, 180, 365] as const;
export type SegmentWindow = (typeof SEGMENT_WINDOWS)[number];
export const SEGMENTS = ["new", "active", "lapsed", "never"] as const;
export type Segment = (typeof SEGMENTS)[number];

export function isSegmentWindow(n: number): n is SegmentWindow {
  return (SEGMENT_WINDOWS as readonly number[]).includes(n);
}
export function isSegment(s: string): s is Segment {
  return (SEGMENTS as readonly string[]).includes(s);
}

export interface SegmentCustomer {
  id: string;
  name: string;
  customerType: string;
  segment: Segment;
  billsInWindow: number;
  spentInWindowMinor: number;
  lastPurchaseAt: Date | null;
}

export async function getCustomerSegments(params: {
  tenantId: string;
  days: SegmentWindow;
  segment?: Segment;
  sort?: "spend" | "visits";
  limit?: number;
  now?: Date;
}) {
  const since = new Date((params.now ?? new Date()).getTime() - params.days * 86_400_000);
  const rows = await db.$queryRaw<
    {
      id: string;
      name: string;
      customerType: string;
      firstAt: Date | null;
      lastAt: Date | null;
      bills: bigint;
      spent: bigint;
    }[]
  >`
    SELECT c."id", c."name", c."customerType"::text AS "customerType",
           agg."firstAt", agg."lastAt", COALESCE(agg."bills", 0) AS "bills", COALESCE(agg."spent", 0) AS "spent"
      FROM "customers" c
      LEFT JOIN LATERAL (
        SELECT MIN(s."completedAt") AS "firstAt", MAX(s."completedAt") AS "lastAt",
               COUNT(*) FILTER (WHERE s."completedAt" >= ${since}) AS "bills",
               SUM(s."totalMinor") FILTER (WHERE s."completedAt" >= ${since}) AS "spent"
          FROM "sales" s
         WHERE s."tenantId" = c."tenantId" AND s."customerId" = c."id" AND s."status" = 'COMPLETED'
      ) agg ON TRUE
     WHERE c."tenantId" = ${params.tenantId} AND c."isActive" = TRUE
  `;

  const all: SegmentCustomer[] = rows.map((r) => {
    const segment: Segment = !r.firstAt
      ? "never"
      : r.firstAt >= since
        ? "new"
        : r.lastAt && r.lastAt >= since
          ? "active"
          : "lapsed";
    return {
      id: r.id,
      name: r.name,
      customerType: r.customerType,
      segment,
      billsInWindow: Number(r.bills),
      spentInWindowMinor: Number(r.spent),
      lastPurchaseAt: r.lastAt,
    };
  });

  const counts = Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Record<Segment, number>;
  const byType: Record<string, Record<Segment, number>> = {};
  let spentInWindowMinor = 0;
  for (const c of all) {
    counts[c.segment] += 1;
    byType[c.customerType] ??= { new: 0, active: 0, lapsed: 0, never: 0 };
    byType[c.customerType]![c.segment] += 1;
    spentInWindowMinor += c.spentInWindowMinor;
  }

  const sort = params.sort ?? "spend";
  const list = all
    .filter((c) => !params.segment || c.segment === params.segment)
    .sort((a, b) =>
      sort === "visits"
        ? b.billsInWindow - a.billsInWindow || b.spentInWindowMinor - a.spentInWindowMinor
        : b.spentInWindowMinor - a.spentInWindowMinor || b.billsInWindow - a.billsInWindow,
    )
    .slice(0, Math.min(params.limit ?? 100, 500));

  return { total: all.length, counts, byType, spentInWindowMinor, customers: list };
}
