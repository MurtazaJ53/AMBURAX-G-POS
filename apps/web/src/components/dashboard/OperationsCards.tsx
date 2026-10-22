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
          <p className="mt-0.5 text-[10px] text-slate-600">Units sold &middot; today</p>
        </div>
      </div>

      <div className="overflow-x-auto flex-1">
        {products.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-600">
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
                  <td className="text-slate-500">{index + 1}</td>
                  <td className="w-full max-w-[0px]"><div className="flex items-center gap-2"><ProductThumb name={product.name} imageUrl={product.imageUrl} /><span className="truncate font-semibold text-slate-700" title={product.name}>{product.name}</span></div></td>
                  <td className="data-mono text-[9px] text-slate-600">{product.sku}</td>
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

      <Link href="/products" className="flex min-h-11 w-full items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-sky-700 hover:bg-slate-50 shrink-0">
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
          {/* "Stock signal", not "low stock": with no reorder levels there is no threshold to be low against. */}
          <h2 className="text-[13px] font-bold text-slate-800">Stock signal</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">
            No reorder levels are configured, so these are the lowest counts in this store.
          </p>
        </div>
        {critical > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-700">
            {critical} to check
          </span>
        )}
      </div>

      <div className="overflow-x-auto flex-1">
        {stock.lowest.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-600">
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
                    <td className="data-mono text-[9px] text-slate-600">{row.sku}</td>
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

      <Link href="/inventory" className="flex min-h-11 w-full items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-sky-700 hover:bg-slate-50 shrink-0">
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
          <p className="mt-0.5 text-[10px] text-slate-600">Latest activity from this store</p>
        </div>
        <Link href="/sales" className="inline-flex min-h-11 min-w-11 items-center justify-center text-[10px] font-semibold text-sky-700 hover:text-sky-900">
          View all <ChevronRight className="inline size-3" />
        </Link>
      </div>

      <div className="overflow-x-auto flex-1">
        {sales.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] font-semibold text-slate-700">No sales yet</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Bills completed at the till appear here.</p>
          </div>
        ) : (
          <table className="dashboard-table w-full table-fixed">
            {/* Four columns that fit the card: time sits under the bill number and the payment
                method under the amount, so the table never needs to scroll sideways. */}
            <thead>
              <tr>
                <th className="w-[30%]">Bill</th>
                <th>Customer</th>
                <th className="w-[26%] text-right">Amount</th>
                <th className="w-[24%]">Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="min-w-0">
                    <Link href={`/sales/${sale.id}`} className="data-mono block truncate text-[10px] font-semibold text-sky-700 hover:underline" title={sale.billNumber}>
                      {sale.billNumber}
                    </Link>
                    <span className="data-mono block text-[9px] text-slate-500">{formatStoreTime(sale.completedAt)}</span>
                  </td>
                  <td className="truncate text-slate-600" title={sale.customerName ?? "Walk-in"}>{sale.customerName ?? "Walk-in"}</td>
                  <td className="text-right">
                    <span className="data-mono block font-semibold text-slate-700">{formatMinor(sale.totalMinor)}</span>
                    <span className="block text-[9px] text-slate-500">{sale.paymentMethod || "Udhar"}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${sale.status === "VOIDED" ? "status-critical" : "status-paid"}`}>
                      {sale.status === "VOIDED" ? "Voided" : "Completed"}
                    </span>
                    {/* Accounting state per row: a completed bill is not yet a posted invoice. */}
                    <span className="mt-0.5 block truncate text-[9px] text-slate-500">
                      {sale.erpSyncStatus === "SYNCED" ? "Posted" : sale.erpSyncStatus === "FAILED" ? "Post failed" : "Not posted"}
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
