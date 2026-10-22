import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { startOfStoreDay, shiftStoreDay, storeDateKey } from "@/server/dashboard/dashboardTransforms";
import {
  canViewReports,
  getSalesReport,
  MAX_REPORT_DAYS,
  resolveReportRange,
  type NamedAmount,
  type SalesReport,
} from "@/server/reports/salesReport";
import { Card, CardHeader, DataTable, KpiCard, PageHeader, PermissionDeniedState, Td, Th } from "../_components/ui";

/**
 * Reports — the store sales report for a chosen range of trading days.
 *
 * Built only from rows that exist: completed sales, their lines, confirmed tenders and
 * completed returns. Profitability is absent because the catalogue carries no cost price;
 * stock valuation is absent for the same reason.
 */

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Breakdown(props: {
  title: string;
  subtitle?: string;
  rows: NamedAmount[];
  total: number;
  countLabel: string;
  empty: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={props.title} subtitle={props.subtitle} />
      {props.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">{props.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {props.rows.map((r) => (
            <li key={r.key} className="px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-800" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-slate-900">{formatMinor(r.amountMinor)}</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div
                    className="amb-line-in h-full origin-left rounded-full bg-primary"
                    style={{ transform: `scaleX(${props.total > 0 ? r.amountMinor / props.total : 0})` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {pct(r.amountMinor, props.total)} · {r.count} {props.countLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {props.footer}
    </Card>
  );
}

const PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  // Read outside the try so Next always sees this page is per-user.
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("reports: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (!canViewReports(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Reports" />
        <PermissionDeniedState
          title="Reports are for owners and store managers"
          description="Store takings and per-cashier figures are management information."
          hint="Ask your store owner if you need access."
        />
      </div>
    );
  }

  const range = resolveReportRange({ from: sp.from, to: sp.to });
  let report: SalesReport;
  try {
    report = await getSalesReport({ tenantId: ctx.tenantId, storeId: ctx.storeId, range });
  } catch (err) {
    logError("reports: sales report failed", err);
    return <ServiceUnavailableScreen />;
  }

  const todayKey = storeDateKey(startOfStoreDay());
  const presetHref = (days: number) =>
    `/reports?from=${storeDateKey(shiftStoreDay(startOfStoreDay(), days - 1))}&to=${todayKey}`;
  const activePreset = PRESETS.find((p) => range.toKey === todayKey && range.days === p.days)?.id;
  const maxDaily = Math.max(0, ...report.daily.map((d) => d.netSalesMinor));
  const rangeText =
    range.fromKey === range.toKey ? dayLabel(range.fromKey) : `${dayLabel(range.fromKey)} – ${dayLabel(range.toKey)}`;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Reports"
        subtitle={`${ctx.storeName} · ${rangeText} · completed sales only, voided bills excluded`}
      />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <nav aria-label="Report period" className="flex rounded-lg bg-slate-100 p-0.5">
          {PRESETS.map((p) => (
            <Link
              key={p.id}
              href={presetHref(p.days)}
              aria-current={activePreset === p.id ? "page" : undefined}
              className={`amb-focus inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold transition-colors ${
                activePreset === p.id ? "bg-white text-sky-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/reports" className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-medium">From</span>
            <input
              type="date"
              name="from"
              defaultValue={range.fromKey}
              max={todayKey}
              className="amb-focus min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-medium">To</span>
            <input
              type="date"
              name="to"
              defaultValue={range.toKey}
              max={todayKey}
              className="amb-focus min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            className="amb-focus amb-press min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Apply
          </button>
        </form>
      </div>

      {range.clamped && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Reports cover at most {MAX_REPORT_DAYS} days, so this shows the last {MAX_REPORT_DAYS} days of the range you
          chose.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Net sales"
          value={formatMinor(report.netSalesMinor)}
          hint={`Tax included · ${formatMinor(report.taxMinor)} tax`}
        />
        <KpiCard label="Bills" value={String(report.billCount)} hint={`${report.itemsSold} items sold`} />
        <KpiCard
          label="Average bill"
          value={report.averageBillMinor === null ? "—" : formatMinor(report.averageBillMinor)}
          hint={report.averageBillMinor === null ? "No bills in this period" : "Net sales ÷ bills"}
        />
        <KpiCard
          label="Refunds"
          value={formatMinor(report.refundMinor)}
          hint={`${report.returnCount} ${report.returnCount === 1 ? "return" : "returns"} · ${report.voidedCount} voided ${
            report.voidedCount === 1 ? "bill" : "bills"
          }`}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="xl:col-span-2">
          <DataTable caption="Sales by trading day">
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Bills</Th>
                <Th align="right">Net sales</Th>
                <Th>
                  <span className="sr-only">Share of busiest day</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {[...report.daily].reverse().map((d) => (
                <tr key={d.key}>
                  <Td>{dayLabel(d.key)}</Td>
                  <Td align="right" className="tabular-nums">
                    {d.billCount}
                  </Td>
                  <Td align="right" className="tabular-nums font-semibold text-slate-900">
                    {d.billCount ? formatMinor(d.netSalesMinor) : "—"}
                  </Td>
                  <Td className="w-1/3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <div
                        className="amb-line-in h-full origin-left rounded-full bg-primary"
                        style={{ transform: `scaleX(${maxDaily > 0 ? d.netSalesMinor / maxDaily : 0})` }}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
        <div className="space-y-4">
          <Breakdown
            title="Payments"
            subtitle="Confirmed tenders"
            rows={report.payments}
            total={report.payments.reduce((s, r) => s + r.amountMinor, 0)}
            countLabel="tenders"
            empty="No payments in this period."
          />
          <Breakdown
            title="Staff"
            subtitle="Sales by the cashier who rang the bill"
            rows={report.cashiers}
            total={report.netSalesMinor}
            countLabel="bills"
            empty="No bills in this period."
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Breakdown
          title="Categories"
          subtitle="Line totals by product category"
          rows={report.categories}
          total={report.categories.reduce((s, r) => s + r.amountMinor, 0) + report.uncategorisedMinor}
          countLabel="units"
          empty="No categorised sales in this period."
          footer={
            report.uncategorisedMinor > 0 ? (
              <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
                {formatMinor(report.uncategorisedMinor)} from products with no category.
              </p>
            ) : undefined
          }
        />
        <Card className="overflow-hidden">
          <CardHeader title="Top products" subtitle="By sales value" />
          {report.products.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nothing sold in this period.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {report.products.map((p, i) => (
                <li key={p.variantId} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-5 shrink-0 tabular-nums text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800" title={p.name}>
                      {p.name}
                    </span>
                    <span className="block font-mono text-xs text-slate-500">{p.sku}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums font-semibold text-slate-900">{formatMinor(p.amountMinor)}</span>
                    <span className="block text-xs tabular-nums text-slate-500">{p.units} units</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Breakdown
          title="Top customers"
          subtitle="Named customers by spend"
          rows={report.customers}
          total={report.netSalesMinor}
          countLabel="bills"
          empty="No sales to named customers in this period."
          footer={
            report.walkInMinor > 0 ? (
              <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
                {formatMinor(report.walkInMinor)} ({pct(report.walkInMinor, report.netSalesMinor)}) from walk-in bills.
              </p>
            ) : undefined
          }
        />
      </div>

      <section aria-labelledby="profit-h" className="amb-fade-in mt-6">
        <Card className="overflow-hidden">
          <CardHeader
            title="Gross profit"
            subtitle="Sales value excluding GST, less weighted average cost when each item sold. Before returns."
          />
          {report.profit.costedUnits === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              {report.profit.uncostedUnits > 0
                ? "None of the items sold in this period had a recorded cost. Record purchases with their cost to see profit."
                : "Nothing sold in this period."}
            </p>
          ) : (
            <>
              <dl className="grid gap-4 px-5 py-4 sm:grid-cols-3 xl:grid-cols-6">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Sales excl. GST</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatMinor(report.profit.revenueExTaxMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Cost of goods sold</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatMinor(report.profit.costMinor)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Gross profit</dt>
                  <dd className={`mt-1 text-lg font-semibold tabular-nums ${report.profit.profitMinor < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {formatMinor(report.profit.profitMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Gross margin</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                    {report.profit.marginBp === null ? "—" : `${(report.profit.marginBp / 100).toFixed(1)}%`}
                  </dd>
                </div>
                <div className="border-t border-slate-100 pt-2 sm:border-t-0 sm:pt-0">
                  <dt className="text-xs font-medium text-slate-500">Net profit (post-returns)</dt>
                  <dd className={`mt-1 text-lg font-semibold tabular-nums ${report.profit.netProfitAfterReturnsMinor < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {formatMinor(report.profit.netProfitAfterReturnsMinor)}
                  </dd>
                </div>
                <div className="border-t border-slate-100 pt-2 sm:border-t-0 sm:pt-0">
                  <dt className="text-xs font-medium text-slate-500">Net margin</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                    {report.profit.netMarginBp === null ? "—" : `${(report.profit.netMarginBp / 100).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>
              {report.profit.uncostedUnits > 0 && (
                <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-amber-800">
                  {report.profit.uncostedUnits} of {report.profit.costedUnits + report.profit.uncostedUnits} units sold had no
                  recorded cost and are left out of these figures.
                </p>
              )}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
