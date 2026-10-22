import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { getStockSignal, getTodayMetrics } from "@/server/dashboard/dashboardQueries";
import { getSalesReport, resolveReportRange } from "@/server/reports/salesReport";
import { LOW_STOCK_MAX_UNITS } from "@/server/inventory/inventoryQueries";
import { roster } from "@/server/staff/attendance";
import { newErpClient, requireErpEnvironment } from "@/server/erp/documentSync";
import { logError } from "@/lib/safeLog";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";

/**
 * Owner / manager operations screens: 55 Store Operations Center, 68/81 Integrations & System
 * Health, 69-71 Multi-store, 72 Company, 78 Data export. Read-only except retrying a failed sync
 * and exporting, both owner-only and audited.
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
const DAY = 86_400_000;

/** IST calendar day (YYYY-MM-DD) of an instant. */
function istKey(at: Date) {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------- 55

export async function getOperationsCenter(params: { tenantId: string; storeId: string; now?: Date }) {
  const now = params.now ?? new Date();
  const today = istKey(now);
  const t = params.tenantId;
  const s = params.storeId;
  const [metrics, openTills, team, lowStock, heldBills, corrections, leave, variances, failedSyncs] = await Promise.all([
    getTodayMetrics({ tenantId: t, storeId: s, now }),
    db.posSession.findMany({
      where: { tenantId: t, storeId: s, closedAt: null },
      select: { id: true, openedAt: true, cashier: { select: { name: true } }, posDevice: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
    }),
    roster({ tenantId: t, storeId: s, date: today, now }),
    db.stockLevel.count({ where: { tenantId: t, storeId: s, quantity: { gt: 0, lte: LOW_STOCK_MAX_UNITS } } }),
    db.heldBill.count({ where: { tenantId: t, storeId: s, expiresAt: { gt: now } } }),
    db.punchCorrection.count({ where: { tenantId: t, storeId: s, status: "PENDING" } }),
    db.staffLeave.count({ where: { tenantId: t, storeId: s, status: "PENDING" } }),
    db.posSession.count({ where: { tenantId: t, storeId: s, varianceStatus: "PENDING_APPROVAL" } }),
    db.outboxEvent.count({ where: { tenantId: t, storeId: s, deadLetteredAt: { not: null } } }),
  ]);
  return {
    today,
    metrics,
    openTills: openTills.map((x) => ({ id: x.id, openedAt: x.openedAt, cashier: x.cashier.name, till: x.posDevice.name })),
    team: {
      in: team.filter((r) => r.state === "in").map((r) => r.name),
      flagged: team.filter((r) => r.flags.length > 0).map((r) => ({ name: r.name, flags: r.flags })),
      total: team.length,
    },
    lowStock,
    heldBills,
    approvals: { corrections, leave, variances },
    failedSyncs,
  };
}

// ---------------------------------------------------------------------------------- 68 / 81

export async function getSystemHealth(params: { tenantId: string }) {
  const [byType, failures, oldestPending] = await Promise.all([
    db.$queryRaw<{ eventType: string; pending: bigint; failed: bigint; published: bigint; lastPublishedAt: Date | null }[]>`
      SELECT "eventType",
             COUNT(*) FILTER (WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL) AS "pending",
             COUNT(*) FILTER (WHERE "deadLetteredAt" IS NOT NULL) AS "failed",
             COUNT(*) FILTER (WHERE "publishedAt" IS NOT NULL) AS "published",
             MAX("publishedAt") AS "lastPublishedAt"
        FROM "outbox_events"
       WHERE "tenantId" = ${params.tenantId}
       GROUP BY "eventType"
       ORDER BY "eventType"
    `,
    db.outboxEvent.findMany({
      where: { tenantId: params.tenantId, deadLetteredAt: { not: null } },
      orderBy: { deadLetteredAt: "desc" },
      take: 50,
      select: { id: true, eventType: true, entityId: true, attempts: true, deadLetteredAt: true, lastError: true, occurredAt: true },
    }),
    db.outboxEvent.findFirst({
      where: { tenantId: params.tenantId, publishedAt: null, deadLetteredAt: null },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    }),
  ]);
  return {
    types: byType.map((r) => ({
      eventType: r.eventType,
      pending: Number(r.pending),
      failed: Number(r.failed),
      published: Number(r.published),
      lastPublishedAt: r.lastPublishedAt,
    })),
    // The stored error can carry ERPNext's response text; keep it short on screen.
    failures: failures.map((f) => ({ ...f, lastError: f.lastError ? f.lastError.slice(0, 300) : null })),
    oldestPendingAt: oldestPending?.occurredAt ?? null,
  };
}

/** Put a failed sync back on the queue. Owner only; each adapter's own idempotency stops duplicates. */
export async function retryFailedSync(input: { actor: Actor; eventId: string }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  const res = await db.outboxEvent.updateMany({
    where: { id: input.eventId, tenantId: input.actor.tenantId, deadLetteredAt: { not: null } },
    data: { deadLetteredAt: null, attempts: 0, nextAttemptAt: new Date() },
  });
  if (res.count !== 1) return { status: "not_found" as const };
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "SyncRetried",
    correlationId: randomUUID(),
    metadata: { eventId: input.eventId },
  });
  return { status: "ok" as const };
}

/** Put all failed syncs back on the queue. Owner only. */
export async function retryAllFailedSyncs(input: { actor: Actor }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  const res = await db.outboxEvent.updateMany({
    where: { tenantId: input.actor.tenantId, deadLetteredAt: { not: null } },
    data: { deadLetteredAt: null, attempts: 0, nextAttemptAt: new Date() },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "SyncRetriedAll",
    correlationId: randomUUID(),
    metadata: { count: res.count },
  });
  return { status: "ok" as const, count: res.count };
}

/**
 * "Sync now": send this business's waiting records to ERPNext immediately, through the same outbox
 * dispatcher the background worker uses (same idempotency, retries and dead-lettering). Bounded to
 * about 20 seconds per press; anything left keeps waiting for the next press or the worker.
 * Owner or store manager; only this tenant's events are touched.
 */
/**
 * Background "Sync now": one run per business at a time, inside the server process, so the button
 * answers at once instead of holding the page for 20 seconds per 50 items. The run stops when the
 * queue has nothing due (failed items wait for their retry time) or after `BACKGROUND_LIMIT_MS`.
 */
const BACKGROUND_LIMIT_MS = 10 * 60_000;
const runningSync = new Map<string, { startedAt: number; sent: number; failed: number }>();

export function backgroundSyncStatus(tenantId: string) {
  return runningSync.get(tenantId) ?? null;
}

export function startBackgroundSync(input: { actor: Actor & { membershipRole: string | null } }) {
  const { actor } = input;
  if (actor.tenantRole !== "OWNER" && actor.membershipRole !== "STORE_MANAGER") return { status: "forbidden" as const };
  if (runningSync.has(actor.tenantId)) return { status: "already_running" as const };
  const progress = { startedAt: Date.now(), sent: 0, failed: 0 };
  runningSync.set(actor.tenantId, progress);
  void (async () => {
    try {
      const publisher = new ErpOutboxPublisher();
      while (Date.now() - progress.startedAt < BACKGROUND_LIMIT_MS) {
        const r = await dispatchOutboxOnce({ tenantId: actor.tenantId, publisher, batchSize: 25 });
        progress.sent += r.published;
        progress.failed += r.failed + r.deadLettered;
        if (r.claimed === 0) break;
      }
      await writeAuditLog({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "SyncNowRequested",
        correlationId: randomUUID(),
        metadata: { sent: progress.sent, failed: progress.failed, background: true },
      });
    } catch {
      /* the next run or the background worker picks up where this stopped */
    } finally {
      runningSync.delete(actor.tenantId);
    }
  })();
  return { status: "started" as const };
}

export async function syncNow(input: { actor: Actor & { membershipRole: string | null } }) {
  const { actor } = input;
  if (actor.tenantRole !== "OWNER" && actor.membershipRole !== "STORE_MANAGER") return { status: "forbidden" as const };
  const publisher = new ErpOutboxPublisher();
  const started = Date.now();
  const total = { sent: 0, failed: 0 };
  while (Date.now() - started < 20_000) {
    const r = await dispatchOutboxOnce({ tenantId: actor.tenantId, publisher, batchSize: 25 });
    total.sent += r.published;
    total.failed += r.failed + r.deadLettered;
    if (r.claimed === 0) break;
  }
  const waiting = await db.outboxEvent.count({ where: { tenantId: actor.tenantId, publishedAt: null, deadLetteredAt: null } });
  await writeAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: "SyncNowRequested",
    correlationId: randomUUID(),
    metadata: { ...total, waiting },
  });
  return { status: "ok" as const, ...total, waiting };
}

// ---------------------------------------------------------------------------------- 69-71

export type StoreFigures = {
  storeId: string;
  name: string;
  code: string;
  city: string;
  state: string;
  todaySalesMinor: number;
  todayBills: number;
  salesMinor: number;
  bills: number;
  averageBillMinor: number | null;
  profitMinor: number;
  marginBp: number | null;
  netProfitAfterReturnsMinor: number;
  netMarginBp: number | null;
  uncostedUnits: number;
  stockValueMinor: number | null;
  valueIncludesEstimate: boolean;
  outOfStock: number;
  openTills: number;
};

/** Every store of the tenant side by side: today, the last N days, stock value and margin. */
export async function getMultiStore(params: { tenantId: string; days?: number; now?: Date; onlyStoreId?: string }): Promise<StoreFigures[]> {
  const now = params.now ?? new Date();
  const days = params.days ?? 30;
  const range = resolveReportRange({ from: istKey(new Date(now.getTime() - (days - 1) * DAY)), to: istKey(now) }, now);
  const stores = await db.store.findMany({
    where: { tenantId: params.tenantId, ...(params.onlyStoreId ? { id: params.onlyStoreId } : {}) },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, city: true, state: true },
  });
  return Promise.all(
    stores.map(async (s) => {
      const [today, report, stock, openTills] = await Promise.all([
        getTodayMetrics({ tenantId: params.tenantId, storeId: s.id, now }),
        getSalesReport({ tenantId: params.tenantId, storeId: s.id, range, topLimit: 1 }),
        getStockSignal({ tenantId: params.tenantId, storeId: s.id, lowestLimit: 1 }),
        db.posSession.count({ where: { tenantId: params.tenantId, storeId: s.id, closedAt: null } }),
      ]);
      const p = report.profit;
      return {
        storeId: s.id,
        name: s.name,
        code: s.code,
        city: s.city,
        state: s.state,
        todaySalesMinor: today.salesMinor,
        todayBills: today.billCount,
        salesMinor: report.netSalesMinor,
        bills: report.billCount,
        averageBillMinor: report.averageBillMinor,
        profitMinor: p.profitMinor,
        marginBp: p.revenueExTaxMinor > 0 ? Math.round((p.profitMinor / p.revenueExTaxMinor) * 10_000) : null,
        netProfitAfterReturnsMinor: p.netProfitAfterReturnsMinor,
        netMarginBp: p.netMarginBp,
        uncostedUnits: p.uncostedUnits,
        stockValueMinor: stock.stockValueMinor,
        valueIncludesEstimate: stock.valueIncludesEstimate,
        outOfStock: stock.outOfStock,
        openTills,
      };
    }),
  );
}

// ---------------------------------------------------------------------------------- 72

export type ErpCompanyView =
  | { status: "ok"; name: string; abbr: string | null; currency: string | null; country: string | null; taxId: string | null }
  | { status: "not_connected" }
  | { status: "unavailable" };

/** The tenant's ERPNext Company, read live. ERPNext is master; nothing is edited here. */
export async function getErpCompany(tenantId: string): Promise<ErpCompanyView> {
  const correlationId = randomUUID();
  let env;
  try {
    env = await requireErpEnvironment(tenantId, correlationId);
  } catch {
    return { status: "not_connected" };
  }
  if (!env.companyId) return { status: "not_connected" };
  try {
    const res = await newErpClient().call(env, { tenantId, correlationId }, {
      method: "GET",
      path: `/api/resource/Company/${encodeURIComponent(env.companyId)}`,
    });
    const d = (res.body as { data?: Record<string, unknown> })?.data ?? {};
    const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : null);
    return {
      status: "ok",
      name: str("company_name") ?? env.companyId,
      abbr: str("abbr"),
      currency: str("default_currency"),
      country: str("country"),
      taxId: str("tax_id"),
    };
  } catch (err) {
    logError("company: ERPNext read failed", err);
    return { status: "unavailable" };
  }
}

// ---------------------------------------------------------------------------------- 78

export type ExportKind = "products" | "customers" | "sales";
export const EXPORT_KINDS: readonly ExportKind[] = ["products", "customers", "sales"];
export const EXPORT_MAX_ROWS = 50_000;

/** One CSV cell. Formula-looking text is prefixed so a spreadsheet won't run it (CSV injection). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rupees = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));

/** Tenant-scoped CSV export, owner only, audited with the row count. */
export async function exportCsv(input: { actor: Actor; kind: ExportKind; days?: number }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  const t = input.actor.tenantId;
  let header: string[];
  let rows: unknown[][];
  if (input.kind === "products") {
    const variants = await db.productVariant.findMany({
      where: { tenantId: t },
      take: EXPORT_MAX_ROWS,
      orderBy: { sku: "asc" },
      select: { sku: true, barcode: true, priceMinor: true, isActive: true, product: { select: { name: true, category: true, brand: true } } },
    });
    header = ["SKU", "Barcode", "Product", "Category", "Brand", "Price (Rs)", "Active"];
    rows = variants.map((v) => [v.sku, v.barcode, v.product.name, v.product.category, v.product.brand, rupees(v.priceMinor), v.isActive ? "yes" : "no"]);
  } else if (input.kind === "customers") {
    const customers = await db.customer.findMany({
      where: { tenantId: t },
      take: EXPORT_MAX_ROWS,
      orderBy: { name: "asc" },
      select: { name: true, phone: true, email: true, gstin: true, isActive: true, createdAt: true },
    });
    header = ["Name", "Phone", "Email", "GSTIN", "Active", "Added"];
    rows = customers.map((c) => [c.name, c.phone, c.email, c.gstin, c.isActive ? "yes" : "no", c.createdAt]);
  } else {
    const since = new Date(Date.now() - Math.min(Math.max(input.days ?? 90, 1), 366) * DAY);
    const sales = await db.sale.findMany({
      where: { tenantId: t, completedAt: { gte: since } },
      take: EXPORT_MAX_ROWS,
      orderBy: { completedAt: "asc" },
      select: {
        billNumber: true,
        completedAt: true,
        status: true,
        subtotalMinor: true,
        discountMinor: true,
        taxMinor: true,
        totalMinor: true,
        paidMinor: true,
        store: { select: { code: true } },
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
      },
    });
    header = ["Bill", "Date", "Store", "Status", "Customer", "Cashier", "Subtotal (Rs)", "Discount (Rs)", "GST (Rs)", "Total (Rs)", "Paid (Rs)"];
    rows = sales.map((s) => [
      s.billNumber,
      s.completedAt,
      s.store.code,
      s.status,
      s.customer?.name ?? "Walk-in",
      s.cashier.name,
      rupees(s.subtotalMinor),
      rupees(s.discountMinor),
      rupees(s.taxMinor),
      rupees(s.totalMinor),
      rupees(s.paidMinor),
    ]);
  }
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  await writeAuditLog({
    tenantId: t,
    userId: input.actor.userId,
    action: "DataExported",
    correlationId: randomUUID(),
    metadata: { kind: input.kind, rows: rows.length, truncated: rows.length === EXPORT_MAX_ROWS },
  });
  return { status: "ok" as const, csv, rows: rows.length };
}
