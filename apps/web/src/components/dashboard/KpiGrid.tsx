import * as React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Package,
  ShoppingBag,
  ShoppingCart,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { percentChange } from "@/server/dashboard/dashboardTransforms";
import type {
  DashboardStockSignal,
  DashboardTodayMetrics,
} from "@/server/dashboard/dashboardQueries";

/**
 * A rupee amount short enough for a card: Indian lakh / crore above Rs 1 lakh (₹46.62 L, ₹170.19 Cr),
 * the exact amount below it. The exact figure always stays available as `full`.
 */
const two = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function compactRupees(minor: number): { short: string; full: string } {
  const full = formatMinor(minor);
  const rupees = Math.abs(minor) / 100;
  const sign = minor < 0 ? "-" : "";
  if (rupees >= 1_00_00_000) return { short: `${sign}₹${two(rupees / 1_00_00_000)} Cr`, full };
  if (rupees >= 1_00_000) return { short: `${sign}₹${two(rupees / 1_00_000)} L`, full };
  return { short: full, full };
}

/** Whole counts with Indian digit grouping: 1,100 · 1,00,000. */
const count = (n: number) => n.toLocaleString("en-IN");

export interface KpiCardProps {
  label: string;
  value: string;
  /** The exact value when `value` is shortened; shown on hover and read by screen readers. */
  fullValue?: string;
  icon: LucideIcon;
  change?: number | null;
  hint: string;
  toneClass: string;
}

export function KpiCard({ label, value, fullValue, icon: Icon, change, hint, toneClass }: KpiCardProps) {
  const isNegative = change !== undefined && change !== null && change < 0;
  
  return (
    <div className="surface-card min-w-0 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-slate-500">
          {label}
        </span>
        <span className={`flex size-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={16} />
        </span>
      </div>
      {/* Value on its own line, comparison under it: a long figure can never run into the comparison. */}
      <div className="mt-3 flex min-w-0 flex-col gap-1">
        <strong
          className="data-mono truncate text-[22px] font-bold leading-tight text-slate-900"
          title={fullValue && fullValue !== value ? fullValue : undefined}
        >
          {fullValue && fullValue !== value ? (
            <>
              <span aria-hidden="true">{value}</span>
              <span className="sr-only">{fullValue}</span>
            </>
          ) : (
            value
          )}
        </strong>
        {change === null ? (
          // The previous period had no trade: there is no percentage to state, and "0%" would
          // read as "flat", which is a different and false claim.
          <span className="text-[10px] text-slate-500">No yesterday comparison</span>
        ) : change !== undefined ? (
          <span className={`flex items-center text-[12px] font-bold ${isNegative ? 'text-rose-600' : 'text-emerald-600'}`}>
            {isNegative ? <ArrowDownRight size={12} aria-hidden="true" /> : <ArrowUpRight size={12} aria-hidden="true" />}
            {/* Direction is announced, not carried by colour and an icon alone. */}
            <span className="sr-only">{isNegative ? "Down" : "Up"}</span>
            <span>{isNegative ? "-" : "+"}{Math.abs(change)}%</span>
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate text-[10px] text-slate-500" title={hint}>{hint}</p>
    </div>
  );
}

export function KpiGrid({
  metrics,
  stock,
}: {
  metrics: DashboardTodayMetrics;
  stock: DashboardStockSignal;
}) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard
        label="TODAY'S SALES"
        value={compactRupees(metrics.salesMinor).short}
        fullValue={compactRupees(metrics.salesMinor).full}
        icon={BarChart3}
        change={percentChange(metrics.salesMinor, metrics.previous.salesMinor)}
        hint={
          metrics.averageBillMinor === null
            ? "No sales yet today"
            : `Average bill ${formatMinor(metrics.averageBillMinor)}`
        }
        toneClass="bg-sky-100 text-sky-700"
      />
      <KpiCard
        label="BILLS / TRANSACTIONS"
        value={count(metrics.billCount)}
        icon={ShoppingCart}
        change={percentChange(metrics.billCount, metrics.previous.billCount)}
        hint={`Yesterday ${metrics.previous.billCount}`}
        toneClass="bg-teal-100 text-teal-700"
      />
      <KpiCard
        label="ITEMS SOLD"
        value={count(metrics.itemsSold)}
        icon={ShoppingBag}
        change={percentChange(metrics.itemsSold, metrics.previous.itemsSold)}
        hint={
          metrics.averageItemsPerBill === null
            ? "No bills yet today"
            : `Average ${metrics.averageItemsPerBill} per bill`
        }
        toneClass="bg-violet-100 text-violet-700"
      />
      <KpiCard
        label="NEW CUSTOMERS"
        value={count(metrics.newCustomers)}
        icon={UserPlus}
        change={percentChange(metrics.newCustomers, metrics.previous.newCustomers)}
        hint="Added today"
        toneClass="bg-amber-100 text-amber-700"
      />
      <KpiCard
        label="Stock value"
        // Weighted average cost x units on hand, excl. GST. Items with no recorded cost are
        // left out and counted in the hint, never valued at zero or at selling price.
        value={stock.stockValueMinor === null ? "—" : compactRupees(stock.stockValueMinor).short}
        fullValue={stock.stockValueMinor === null ? undefined : compactRupees(stock.stockValueMinor).full}
        icon={Package}
        hint={
          stock.stockValueMinor === null
            ? "No purchase costs recorded yet"
            : stock.uncostedOnHand > 0
              ? `At cost · ${stock.uncostedOnHand} ${stock.uncostedOnHand === 1 ? "item" : "items"} without a cost`
              : stock.valueIncludesEstimate
                ? "At cost · includes estimated older stock"
                : "At cost, excluding GST"
        }
        toneClass="bg-rose-100 text-rose-700"
      />
    </section>
  );
}
