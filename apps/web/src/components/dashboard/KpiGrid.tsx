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

export interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  change?: number | null;
  hint: string;
  toneClass: string;
}

export function KpiCard({ label, value, icon: Icon, change, hint, toneClass }: KpiCardProps) {
  const isNegative = change !== undefined && change !== null && change < 0;
  
  return (
    <div className="surface-card rounded-lg p-4">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-slate-500">
          {label}
        </span>
        <span className={`flex size-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <strong className="data-mono text-[22px] font-bold text-slate-900">
          {value}
        </strong>
        {change !== undefined && change !== null && (
          <span className={`flex items-center text-[12px] font-bold ${isNegative ? 'text-rose-500' : 'text-emerald-500'}`}>
            {isNegative ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[10px] text-slate-400" title={hint}>{hint}</p>
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
        value={formatMinor(metrics.salesMinor)}
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
        value={String(metrics.billCount)}
        icon={ShoppingCart}
        change={percentChange(metrics.billCount, metrics.previous.billCount)}
        hint={`Yesterday ${metrics.previous.billCount}`}
        toneClass="bg-teal-100 text-teal-700"
      />
      <KpiCard
        label="ITEMS SOLD"
        value={String(metrics.itemsSold)}
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
        value={String(metrics.newCustomers)}
        icon={UserPlus}
        change={percentChange(metrics.newCustomers, metrics.previous.newCustomers)}
        hint="Added today"
        toneClass="bg-amber-100 text-amber-700"
      />
      <KpiCard
        label="TRACKED ITEMS"
        value={String(stock.countedVariants)}
        icon={Package}
        hint={`${stock.outOfStock} out of stock • ${stock.uncountedVariants} uncounted`}
        toneClass="bg-rose-100 text-rose-700"
      />
    </section>
  );
}
