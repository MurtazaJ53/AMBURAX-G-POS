import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatStoreTime } from "@/server/dashboard/dashboardTransforms";
import type { DashboardBreakdown, DashboardStockSignal } from "@/server/dashboard/dashboardQueries";
import type { SaleListRow } from "@/server/sales/saleQueries";
import { ProductThumb } from "./primitives";

export function FastMovingProductsCard({
  products,
}: {
  products: DashboardBreakdown["topProducts"];
}) {
  return (
    <div className="surface-card overflow-hidden rounded-lg flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-slate-800">Fast-moving products</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Units sold &middot; today</p>
        </div>
      </div>

      <div className="overflow-x-auto flex-1">
        {products.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            Nothing sold yet today.
          </div>
        ) : (
          <table className="dashboard-table w-full min-w-[390px] xl:min-w-0">
            <thead>
              <tr>
                <th className="w-8">#</th><th className="w-full">Product</th><th className="whitespace-nowrap">SKU</th><th className="whitespace-nowrap">Sold</th><th className="whitespace-nowrap text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, index) => (
                <tr key={product.variantId}>
                  <td className="text-slate-400">{index + 1}</td>
                  <td className="w-full max-w-[0px]"><div className="flex items-center gap-2"><ProductThumb name={product.name} imageUrl={product.imageUrl} /><span className="truncate font-semibold text-slate-700" title={product.name}>{product.name}</span></div></td>
                  <td className="data-mono text-[9px] text-slate-400">{product.sku}</td>
                  <td className="font-semibold text-slate-600">{product.unitsSold}</td>
                  <td className="data-mono text-right font-semibold text-slate-700">
                    {formatMinor(product.revenueMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link href="/products" className="flex w-full items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-sky-700 hover:bg-slate-50 shrink-0">
        View all products <ChevronRight size={12} />
      </Link>
    </div>
  );
}

export function StockSignalCard({ stock }: { stock: DashboardStockSignal }) {
  const critical = stock.outOfStock + stock.oversold;

  return (
    <div className="surface-card overflow-hidden rounded-lg flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-slate-800">Low stock signal</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Items needing attention</p>
        </div>
        {critical > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-600">
            {critical} items
          </span>
        )}
      </div>

      <div className="overflow-x-auto flex-1">
        {stock.lowest.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            Nothing counted in this store yet.
          </div>
        ) : (
          <table className="dashboard-table w-full min-w-[350px] xl:min-w-0">
            <thead>
              <tr>
                <th className="w-full">Product</th><th className="whitespace-nowrap">SKU</th><th className="whitespace-nowrap">Available</th><th className="whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {stock.lowest.map((row) => {
                const status = row.quantity <= 0 ? 'Critical' : 'Low';
                return (
                  <tr key={row.variantId}>
                    <td className="w-full max-w-[0px]"><div className="flex items-center gap-2"><ProductThumb name={row.productName} imageUrl={row.imageUrl} /><span className="truncate font-semibold text-slate-700" title={row.productName}>{row.productName}</span></div></td>
                    <td className="data-mono text-[9px] text-slate-400">{row.sku}</td>
                    <td className="data-mono font-bold text-slate-700">{row.quantity}</td>
                    <td>
                      <span className={`status-badge ${status === 'Critical' ? 'status-critical' : 'status-low'}`}>
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Link href="/inventory" className="flex w-full items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-sky-700 hover:bg-slate-50 shrink-0">
        Open inventory <ChevronRight size={12} />
      </Link>
    </div>
  );
}

export function RecentSalesCard({ sales }: { sales: SaleListRow[] }) {
  return (
    <div className="surface-card overflow-hidden rounded-lg flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-slate-800">Recent sales</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Latest activity from this store</p>
        </div>
        <Link href="/sales" className="text-[10px] font-semibold text-sky-700 hover:text-sky-900">
          View all <ChevronRight className="inline size-3" />
        </Link>
      </div>

      <div className="overflow-x-auto flex-1">
        {sales.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            No sales yet.
          </div>
        ) : (
          <table className="dashboard-table w-full min-w-[460px] xl:min-w-0">
            <thead>
              <tr>
                <th className="whitespace-nowrap">Time</th><th className="whitespace-nowrap">Bill no.</th><th className="w-full">Customer</th><th className="whitespace-nowrap">Amount</th><th className="whitespace-nowrap">Payment</th><th className="whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="data-mono text-[9px] text-slate-400">{formatStoreTime(sale.completedAt)}</td>
                  <td className="data-mono text-[9px] font-semibold text-sky-700">
                    <Link href={`/sales/${sale.id}`} className="hover:underline">
                      {sale.billNumber}
                    </Link>
                  </td>
                  <td className="w-full max-w-[0px] truncate text-slate-600" title={sale.customerName ?? "Walk-in"}>{sale.customerName ?? "Walk-in"}</td>
                  <td className="data-mono font-semibold text-slate-700">{formatMinor(sale.totalMinor)}</td>
                  <td className="data-mono text-[9px] font-medium text-slate-500">{sale.paymentMethod || "—"}</td>
                  <td>
                    <span className={`status-badge ${sale.status === "VOIDED" ? "status-critical" : "status-paid"}`}>
                      {sale.status === "VOIDED" ? "Voided" : "Completed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
