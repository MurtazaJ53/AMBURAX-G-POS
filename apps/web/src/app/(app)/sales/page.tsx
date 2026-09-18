import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  listSalesPage,
  getSalesSummary,
  SALES_PAGE_SIZE,
  type SalesPage,
  type SalesSummary,
} from "@/server/sales/saleQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "./formatDateTime";
import {
  Card,
  DataTable,
  EmptyState,
  KpiCard,
  LinkButton,
  PageHeader,
  Pagination,
  StatusBadge,
  Td,
  Th,
  buttonClass,
} from "../_components/ui";

/**
 * Sales & transaction history.
 *
 * Server-rendered with plain GET forms, so every view is a real URL: searches and filters
 * are linkable, survive a refresh and work without JavaScript. A till that has just been
 * reloaded is exactly when someone needs to find the last bill.
 *
 * Filters are limited to what the data can actually answer — text, tender and date range.
 * The design reference also shows Returns, Exchanges and Drafts tabs and an Export button;
 * none of those exist in this system, so none of them are drawn here.
 */

const PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function parseMethod(value: string | undefined): PaymentMethod | undefined {
  return PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : undefined;
}

/** A date input gives `YYYY-MM-DD`; interpret it at IST midnight, the store's trading day. */
function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const base = Date.UTC(y!, m! - 1, d!, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(endOfDay ? base + 24 * 60 * 60 * 1000 : base);
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; method?: string; from?: string; to?: string; page?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;

  const query = (sp.q ?? "").slice(0, 100);
  const method = parseMethod(sp.method);
  const from = parseDate(sp.from);
  const to = parseDate(sp.to, true);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("sales: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");
  const context = resolved.context;

  const filters = { tenantId: context.tenantId, storeId: context.storeId, query, method, from, to };

  let result: SalesPage;
  let summary: SalesSummary;
  try {
    [result, summary] = await Promise.all([
      listSalesPage({ ...filters, page }),
      getSalesSummary(filters),
    ]);
  } catch (err) {
    logError("sales: history load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const hasFilters = Boolean(query || method || sp.from || sp.to);
  const carried = { q: query || undefined, method, from: sp.from, to: sp.to };

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Sales & transactions"
        subtitle={`Every completed sale in ${context.storeName}`}
        actions={context.canSell ? <LinkButton href="/pos">+ New Sale</LinkButton> : undefined}
      />

      {/* Figures describe the filtered set, so they always match the rows on screen. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={hasFilters ? "Sales (filtered)" : "Total sales"}
          value={formatMinor(summary.totalMinor)}
          tone="blue"
        />
        <KpiCard label="Bills" value={String(summary.billCount)} tone="violet" />
        <KpiCard
          label="Average bill"
          value={summary.averageBillMinor === null ? "—" : formatMinor(summary.averageBillMinor)}
          hint={summary.averageBillMinor === null ? "No sales in this view" : undefined}
          tone="emerald"
        />
        {/* Truthful, and the number a merchant will eventually care about most. */}
        <KpiCard
          label="Not posted"
          value={String(summary.unpostedCount)}
          hint="Awaiting accounting integration"
          tone="amber"
        />
      </div>

      <Card className="mt-6">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="sales-q" className="block text-xs font-medium text-slate-600">
              Search
            </label>
            <input
              id="sales-q"
              name="q"
              defaultValue={query}
              placeholder="Bill number, customer name or phone"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label htmlFor="sales-method" className="block text-xs font-medium text-slate-600">
              Payment
            </label>
            <select
              id="sales-method"
              name="method"
              defaultValue={method ?? ""}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sales-from" className="block text-xs font-medium text-slate-600">
              From
            </label>
            <input
              id="sales-from"
              type="date"
              name="from"
              defaultValue={sp.from ?? ""}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label htmlFor="sales-to" className="block text-xs font-medium text-slate-600">
              To
            </label>
            <input
              id="sales-to"
              type="date"
              name="to"
              defaultValue={sp.to ?? ""}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <button type="submit" className={buttonClass("primary")}>
            Apply
          </button>
          {hasFilters && (
            <Link href="/sales" className={buttonClass("secondary")}>
              Reset
            </Link>
          )}
        </form>

        {result.rows.length === 0 ? (
          // Two genuinely different questions: "you have not sold anything" and "your
          // filters matched nothing". Collapsing them would leave an operator wondering
          // whether a sale was lost.
          hasFilters ? (
            <EmptyState
              title="No sales match these filters"
              description="Try a different bill number, customer, tender or date range."
              action={
                <Link href="/sales" className={buttonClass("secondary")}>
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No sales yet"
              description="Completed sales in this store will appear here."
              action={
                context.canSell ? <LinkButton href="/pos">Open the till</LinkButton> : undefined
              }
            />
          )
        ) : (
          <>
            <DataTable caption="Sales history">
              <thead className="border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <Th>Date &amp; time</Th>
                  <Th>Bill no.</Th>
                  <Th>Customer</Th>
                  <Th>Cashier</Th>
                  <Th align="right">Amount</Th>
                  <Th>Payment</Th>
                  <Th>Status</Th>
                  <Th>Accounting</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {result.rows.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap text-slate-500">
                      {formatDateTime(sale.completedAt)}
                    </Td>
                    <Td>
                      <Link
                        href={`/sales/${sale.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {sale.billNumber}
                      </Link>
                    </Td>
                    <Td>{sale.customerName ?? "Walk-in"}</Td>
                    <Td className="text-slate-500">{sale.cashierName}</Td>
                    <Td align="right" className="font-medium text-slate-900">
                      {formatMinor(sale.totalMinor)}
                    </Td>
                    <Td className="text-slate-600">{sale.paymentMethod ?? "—"}</Td>
                    <Td>
                      {sale.status === "VOIDED" ? (
                        <StatusBadge tone="danger">Voided</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Paid</StatusBadge>
                      )}
                    </Td>
                    <Td>
                      {sale.erpSyncStatus === "SYNCED" ? (
                        <StatusBadge tone="success">Posted</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Not posted</StatusBadge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>

            <Pagination
              basePath="/sales"
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={SALES_PAGE_SIZE}
              params={carried}
            />
          </>
        )}
      </Card>
    </div>
  );
}
