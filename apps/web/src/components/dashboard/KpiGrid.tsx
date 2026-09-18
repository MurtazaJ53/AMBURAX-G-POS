import * as React from "react";
import {
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
import { ChangeIndicator } from "./primitives";

/**
 * The five figures across the top of the dashboard.
 *
 * Four of them are the design reference's, unchanged: takings, bills, units, new customers.
 * The fifth is not. The reference shows an inventory *valuation*, and AMBURAX has no cost
 * price on a variant, so there is no honest rupee figure to put there — valuing stock at its
 * selling price would be a gross-margin error dressed up as an asset. The slot instead
 * carries what the data does support: how much of the catalogue this store has actually
 * counted.
 *
 * Every movement arrow is a real comparison against the previous trading day. Where
 * yesterday had no trade, the card says so rather than showing a percentage computed from
 * zero.
 */

export interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Null renders the honest "no comparison" line instead of an arrow. */
  change?: number | null;
  hint: string;
  /** Marks the figure as covering the whole business rather than the active store. */
  scopeNote?: string;
}

export function KpiCard({ label, value, icon: Icon, change, hint, scopeNote }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-background-card p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">{label}</p>
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-subtle"
        >
          <Icon className="h-3.5 w-3.5" style={{ color: "var(--color-primary)" }} />
        </span>
      </div>
      <p className="text-lg font-extrabold leading-tight text-primary">{value}</p>
      {change !== undefined && (
        <div className="mt-1 flex items-center gap-1.5">
          <ChangeIndicator value={change} />
        </div>
      )}
      <p className="mt-1 text-[10px] text-tertiary">{hint}</p>
      {scopeNote && <p className="mt-0.5 text-[10px] text-tertiary">{scopeNote}</p>}
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        label="Today's sales"
        value={formatMinor(metrics.salesMinor)}
        icon={BarChart3}
        change={percentChange(metrics.salesMinor, metrics.previous.salesMinor)}
        hint={
          metrics.averageBillMinor === null
            ? "No sales yet today"
            : `Average bill ${formatMinor(metrics.averageBillMinor)}`
        }
      />
      <KpiCard
        label="Bills"
        value={String(metrics.billCount)}
        icon={ShoppingCart}
        change={percentChange(metrics.billCount, metrics.previous.billCount)}
        hint={`Yesterday ${metrics.previous.billCount}`}
      />
      <KpiCard
        label="Items sold"
        value={String(metrics.itemsSold)}
        icon={ShoppingBag}
        change={percentChange(metrics.itemsSold, metrics.previous.itemsSold)}
        hint={
          metrics.averageItemsPerBill === null
            ? "No bills yet today"
            : `Average ${metrics.averageItemsPerBill} per bill`
        }
      />
      <KpiCard
        label="New customers"
        value={String(metrics.newCustomers)}
        icon={UserPlus}
        change={percentChange(metrics.newCustomers, metrics.previous.newCustomers)}
        hint="Added today"
        // Customers belong to the business, not to a shop floor, so this one figure is not
        // store-scoped like its neighbours. Saying so is cheaper than a support ticket
        // asking why two stores report the same number.
        scopeNote="Across the whole business"
      />
      <KpiCard
        label="Stock counted"
        value={String(stock.countedVariants)}
        icon={Package}
        hint={`${stock.outOfStock} out of stock · ${stock.uncountedVariants} never counted`}
        scopeNote="No valuation — variants carry no cost price"
      />
    </div>
  );
}
