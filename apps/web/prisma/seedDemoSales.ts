import type { PrismaClient } from "@prisma/client";
import { createSale } from "../src/server/sales/saleService";

/**
 * Deterministic historical sales for `db:seed:demo`.
 *
 * Every sale is created through the same production `createSale` transaction the POS uses
 * — pricing, tax, bill numbering, stock decrement, the outbox event and the audit log are
 * all the real service, not reconstructed here. `saleService.ts` is not touched or extended
 * for this: it has no parameter for a historical date because a real sale is always "now",
 * so the only seed-only step is backdating `completedAt`/`createdAt` on the row *after* the
 * real transaction has already committed it correctly.
 *
 * Idempotency key per sale is `demo-seed-sale-<index>`, so `createSale`'s own duplicate-key
 * path (not a duplicate-checking layer here) is what makes a second run a no-op: the fast
 * path finds the existing row and returns it, never re-touching stock or the bill counter.
 * That is also why variant/customer selection below only has to be reproducible *within one
 * calendar day of seeding* — once a sale exists, nothing in this module inspects its lines
 * again, so a later run choosing a colour combination in a different order changes nothing.
 *
 * Discount is always 0. D-1 (discount authorization) is a known, deliberately open gap;
 * demo data must not be the thing that exercises it.
 */

const SALE_COUNT = 60;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * A specific IST wall-clock instant, `daysAgo` days before the seed run's own IST calendar
 * date. Same construction as `dashboardQueries.startOfStoreDay` — a fixed offset is exact
 * for India, which has no daylight saving.
 */
function istInstant(anchor: Date, daysAgo: number, hour: number, minute: number): Date {
  const anchorIst = new Date(anchor.getTime() + IST_OFFSET_MS);
  const y = anchorIst.getUTCFullYear();
  const m = anchorIst.getUTCMonth();
  const d = anchorIst.getUTCDate() - daysAgo;
  return new Date(Date.UTC(y, m, d, hour, minute, 0) - IST_OFFSET_MS);
}

/** CASH ~40%, UPI ~40%, CARD ~20% — the distribution the demo brief asked for. */
function paymentMethodFor(i: number): "CASH" | "UPI" | "CARD" {
  const r = i % 5;
  return r < 2 ? "CASH" : r < 4 ? "UPI" : "CARD";
}

/** Most sales 1-3 items, some 4-6, rare 7-9 — never overselling the high-stock pool. */
function quantityFor(i: number): number {
  const r = i % 10;
  if (r === 9) return 7 + (i % 3); // rare: 7-9
  if (r >= 7) return 4 + (i % 3); // some: 4-6
  return 1 + (i % 3); // most: 1-3
}

/** Roughly one in four sales carries a second, different line item. */
function hasSecondLine(i: number): boolean {
  return i % 4 === 0;
}

/**
 * 12 today, 10 yesterday, 26 across the previous six days, 12 older — enough for the Sales
 * screen's date filters and pagination to have something real to filter and page through.
 */
function dateBucketFor(i: number): { daysAgo: number; hour: number; minute: number } {
  let daysAgo: number;
  if (i < 12) daysAgo = 0;
  else if (i < 22) daysAgo = 1;
  else if (i < 48) daysAgo = 2 + ((i - 22) % 6);
  else daysAgo = 8 + ((i - 48) % 14);
  return { daysAgo, hour: 10 + (i % 10), minute: (i * 7) % 60 };
}

/**
 * Which of the eligible named customers a sale goes to, skewed so a few customers end up
 * with several purchases and higher lifetime spend while most get a couple — the shape the
 * Customers screen needs to look like a real roster rather than a flat list.
 */
const CUSTOMER_ROTATION: number[] = (() => {
  const heavy = [0, 1, 2, 3, 4];
  const light = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  return [...heavy, ...light, ...heavy]; // length 20
})();

function customerIndexForNamedSale(namedCounter: number): number {
  return CUSTOMER_ROTATION[namedCounter % CUSTOMER_ROTATION.length]!;
}

export interface DemoSalesResult {
  created: number;
  duplicate: number;
  failed: { index: number; status: string }[];
  dateCounts: { today: number; yesterday: number; last7: number; older: number };
}

export async function seedDemoSales(
  db: PrismaClient,
  params: { tenantId: string; storeId: string },
): Promise<DemoSalesResult> {
  const now = new Date();

  const [owner, storeManager, cashier, customers, stockRows] = await Promise.all([
    db.user.findFirst({ where: { tenantId: params.tenantId, tenantRole: "OWNER" }, select: { id: true } }),
    db.user.findFirst({
      where: {
        tenantId: params.tenantId,
        memberships: { some: { role: "STORE_MANAGER", storeId: params.storeId } },
      },
      select: { id: true },
    }),
    db.user.findFirst({
      where: { tenantId: params.tenantId, memberships: { some: { role: "CASHIER", storeId: params.storeId } } },
      select: { id: true },
    }),
    db.customer.findMany({
      where: { tenantId: params.tenantId },
      select: { id: true, phone: true },
      orderBy: { phone: "asc" },
    }),
    // The safe pool for automatic sale generation: only variants with real, healthy stock
    // in this store. Dynamic rather than a hardcoded SKU list, so it stays correct even if
    // the catalogue above changes. Out-of-stock, low-stock and never-counted variants are
    // never touched by generated demo sales — a demo must not start pre-oversold.
    db.stockLevel.findMany({
      where: { storeId: params.storeId, quantity: { gte: 20 } },
      select: { variantId: true, quantity: true, variant: { select: { sku: true, priceMinor: true } } },
    }),
  ]);

  if (!owner) throw new Error("Demo owner not found — run db:seed before db:seed:demo.");

  const cashiers = [owner.id, storeManager?.id ?? owner.id, cashier?.id ?? owner.id];

  // Stable selection order independent of database insertion order, so the *shape* of the
  // dataset (who buys what) does not depend on incidental row order.
  const safePool = [...stockRows].sort(
    (a, b) => b.quantity - a.quantity || a.variant.sku.localeCompare(b.variant.sku),
  );
  const highStockPool = safePool.filter((r) => r.quantity >= 40);
  if (safePool.length < 3) {
    throw new Error("Not enough well-stocked variants to generate demo sales safely.");
  }

  let created = 0;
  let duplicate = 0;
  const failed: { index: number; status: string }[] = [];
  const dateCounts = { today: 0, yesterday: 0, last7: 0, older: 0 };

  let namedCounter = 0;

  // Submitted oldest-first, so bill numbers ascend with time like a real till's — the loop
  // index `i` still drives every deterministic choice (payment, quantity, customer, which
  // date bucket), only the *order sales are created in* changes here, because that order is
  // what Store.nextBillSeq assigns sequence numbers by. Sorted on the actual computed
  // instant, not just the day bucket, so two sales on the same calendar day still come out
  // in the right order relative to each other — a real till's numbering never runs backward
  // within a single day either.
  const submissionOrder = Array.from({ length: SALE_COUNT }, (_, i) => i).sort((a, b) => {
    const bucketA = dateBucketFor(a);
    const bucketB = dateBucketFor(b);
    return (
      istInstant(now, bucketA.daysAgo, bucketA.hour, bucketA.minute).getTime() -
      istInstant(now, bucketB.daysAgo, bucketB.hour, bucketB.minute).getTime()
    );
  });

  for (const i of submissionOrder) {
    const { daysAgo, hour, minute } = dateBucketFor(i);
    if (daysAgo === 0) dateCounts.today++;
    else if (daysAgo === 1) dateCounts.yesterday++;
    else if (daysAgo <= 7) dateCounts.last7++;
    else dateCounts.older++;

    const named = i % 10 < 7; // ~70% named, ~30% walk-in
    let customerId: string | null = null;
    if (named) {
      const idx = customerIndexForNamedSale(namedCounter);
      customerId = customers[idx]?.id ?? null;
      namedCounter++;
    }

    const quantity = quantityFor(i);
    const usingHighQuantity = quantity >= 7;
    const pool = usingHighQuantity && highStockPool.length > 0 ? highStockPool : safePool;
    const primary = pool[i % pool.length]!;

    const lines = [{ variantId: primary.variantId, quantity }];
    if (hasSecondLine(i)) {
      const secondary = pool[(i * 13 + 7) % pool.length]!;
      if (secondary.variantId !== primary.variantId) {
        lines.push({ variantId: secondary.variantId, quantity: 1 + (i % 2) });
      }
    }

    const method = paymentMethodFor(i);
    const result = await createSale({
      tenantId: params.tenantId,
      storeId: params.storeId,
      cashierUserId: cashiers[i % cashiers.length]!,
      idempotencyKey: `demo-seed-sale-${i}`,
      lines,
      customerId,
      payment: {
        method,
        reference: method === "CASH" ? undefined : `DEMO-${method}-${String(i).padStart(3, "0")}`,
      },
      correlationId: `demo-seed-${i}`,
    });

    if (result.status !== "ok") {
      failed.push({ index: i, status: result.status });
      continue;
    }

    if (result.duplicate) {
      duplicate++;
    } else {
      created++;
    }

    // Backdate after the real transaction has committed. This never runs inside
    // createSale's own transaction and never influences pricing, stock or the bill
    // number — it only moves where this row sits on the calendar for the demo.
    const completedAt = istInstant(now, daysAgo, hour, minute);
    await db.sale.update({
      where: { id: result.sale.id },
      data: { completedAt, createdAt: completedAt },
    });
  }

  return { created, duplicate, failed, dateCounts };
}
