"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchSaleDetailAction } from "../actions";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../formatDateTime";
import type { SalesPage, SalesSummary, SalesAnalytics, SaleListRow, SalesFilters } from "@/server/sales/saleQueries";
import type { SaleDetail } from "@/server/sales/saleQueries";
import {
  ShoppingCart,
  Receipt,
  RotateCcw,
  WalletCards,
  CalendarDays,
  Search,
  X,
  User,
  Printer,
  ChevronRight,
  Filter
} from "lucide-react";
import {
  Card,
  KpiCard,
  StatusBadge,
  DataTable,
  Th,
  Td,
  Pagination,
  EmptyState,
} from "../../_components/ui";

interface Props {
  page: SalesPage;
  summary: SalesSummary;
  analytics: SalesAnalytics;
  carriedParams: Record<string, string | undefined>;
}

const TABS = [
  { id: "all", label: "All Transactions", count: undefined },
  { id: "COMPLETED", label: "Completed", count: undefined },
  { id: "VOIDED", label: "Voided", count: undefined },
];

export function SalesWorkspace({ page, summary, analytics, carriedParams }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedSale, setSelectedSale] = useState<SaleListRow | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filters State
  const q = searchParams.get("q") ?? "";
  const method = searchParams.get("method") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const statusTab = searchParams.get("status") ?? "all";

  const updateFilters = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val) {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleRowClick = async (row: SaleListRow) => {
    setSelectedSale(row);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const data = await fetchSaleDetailAction(row.id);
      setDetail(data);
    } catch (err) {
      console.error("Failed to fetch detail", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Sales"
          value={formatMinor(summary.totalMinor)}
          tone="blue"
          icon={<ShoppingCart size={18} className="text-blue-600" />}
        />
        <KpiCard 
          label="Total Bills" 
          value={String(summary.billCount)} 
          tone="violet"
          icon={<Receipt size={18} className="text-violet-600" />}
        />
        <KpiCard
          label="Returns / Exchanges"
          value="Unavailable"
          hint="Schema restricts to COMPLETED/VOIDED"
          tone="amber"
          icon={<RotateCcw size={18} className="text-amber-600" />}
        />
        <KpiCard
          label="Avg. Bill Value"
          value={summary.averageBillMinor === null ? "—" : formatMinor(summary.averageBillMinor)}
          tone="emerald"
          icon={<WalletCards size={18} className="text-emerald-600" />}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm text-sm">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Date Picker (Pseudo) */}
          <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-1.5 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white shadow-sm transition-shadow">
            <CalendarDays size={14} className="text-slate-400" />
            <input
              type="date"
              className="bg-transparent text-slate-700 outline-none text-[13px] w-[110px]"
              value={from}
              onChange={(e) => updateFilters({ from: e.target.value })}
              aria-label="From Date"
            />
            <span className="text-slate-300">-</span>
            <input
              type="date"
              className="bg-transparent text-slate-700 outline-none text-[13px] w-[110px]"
              value={to}
              onChange={(e) => updateFilters({ to: e.target.value })}
              aria-label="To Date"
            />
            <button className="ml-1 text-slate-400 hover:text-slate-600" onClick={() => updateFilters({ from: undefined, to: undefined })} title="Clear Dates">
              <X size={14} />
            </button>
          </div>

          {/* Selects */}
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-shadow"
            value={method}
            onChange={(e) => updateFilters({ method: e.target.value === "all" ? undefined : e.target.value })}
          >
            <option value="all">All Payment Modes</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto flex-1 lg:flex-none justify-end">
          {/* Search */}
          <div className="relative flex-1 lg:w-72 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-10 text-[13px] text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-shadow placeholder:text-slate-400"
              placeholder="Search by bill no, customer, phone..."
              value={q}
              onChange={(e) => updateFilters({ q: e.target.value })}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              ⌘K
            </div>
          </div>

          <button className="flex items-center gap-1.5 text-[13px] font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap">
            <Filter size={14} />
            More Filters
          </button>
          
          {(q || method || from || to || statusTab !== "all") && (
            <button
              onClick={() => router.push(pathname)}
              className="text-[13px] font-medium text-slate-500 hover:text-slate-700 hover:underline whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-6 px-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => updateFilters({ status: tab.id === "all" ? undefined : tab.id })}
              className={`whitespace-nowrap border-b-2 py-3 px-1 text-[13px] font-medium tracking-wide transition-colors ${
                statusTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Workspace Split */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <div className="flex-1 w-full min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {page.rows.length === 0 ? (
            <EmptyState
              title="No sales found"
              description="No transactions match the current filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <DataTable caption="Transactions">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <Th align="center">
                      <input type="checkbox" disabled className="rounded border-slate-300 text-blue-600" />
                    </Th>
                    <Th>Date & Time</Th>
                    <Th>Bill No.</Th>
                    <Th>Customer</Th>
                    <Th align="right">Amount</Th>
                    <Th>Payment Mode</Th>
                    <Th>Status</Th>
                    <Th align="right">Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[13px]">
                  {page.rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => handleRowClick(row)}
                      className={`cursor-pointer transition-colors ${
                        selectedSale?.id === row.id ? "bg-blue-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <Td className="px-4 py-2.5 text-center">
                        <input type="checkbox" disabled className="rounded border-slate-300 text-blue-600 opacity-50" />
                      </Td>
                      <Td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{formatDateTime(row.completedAt)}</Td>
                      <Td className="px-4 py-2.5 font-medium text-blue-600">{row.billNumber}</Td>
                      <Td className="px-4 py-2.5 text-slate-700">{row.customerName ?? "Walk-in Customer"}</Td>
                      <Td align="right" className="px-4 py-2.5 font-medium text-slate-900">{formatMinor(row.totalMinor)}</Td>
                      <Td className="px-4 py-2.5 text-slate-600">{row.paymentMethod ?? "—"}</Td>
                      <Td className="px-4 py-2.5">
                        {row.status === "VOIDED" ? (
                          <StatusBadge tone="danger">Voided</StatusBadge>
                        ) : (
                          <StatusBadge tone="success">Paid</StatusBadge>
                        )}
                      </Td>
                      <Td className="px-4 py-2.5 text-right font-medium text-blue-600 hover:text-blue-800">
                        View
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 flex items-center justify-between">
                <div>
                  Showing {Math.min((page.page - 1) * 20 + 1, page.total)}–{Math.min(page.page * 20, page.total)} of {page.total} transactions
                </div>
                <Pagination
                  basePath="/sales"
                  page={page.page}
                  pageCount={page.pageCount}
                  total={page.total}
                  pageSize={20}
                  params={carriedParams}
                />
              </div>
            </div>
          )}
        </div>

        {/* Inspector Slide-over (Right Pane) */}
        {selectedSale && (
          <div className="w-full lg:w-[360px] shrink-0 min-h-[500px] flex flex-col relative overflow-hidden bg-white shadow-md border border-slate-200 rounded-xl">
            {/* Inspector Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-white">
              <h3 className="font-semibold text-slate-800 text-sm">Transaction Details</h3>
              <button
                onClick={() => setSelectedSale(null)}
                className="rounded-full p-1.5 hover:bg-slate-100 text-slate-400 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm bg-slate-50/50">
              {/* Sticky Summary Header */}
              <div className="mb-6">
                <div className="flex justify-between items-start mb-1">
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">{selectedSale.billNumber}</h2>
                  {selectedSale.status === "VOIDED" ? (
                    <StatusBadge tone="danger">Voided</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">Paid</StatusBadge>
                  )}
                </div>
                <p className="text-[13px] text-slate-500 mb-1">{formatDateTime(selectedSale.completedAt)}</p>
                {selectedSale.cashierName && (
                  <p className="text-[13px] text-slate-500">Cashier: {selectedSale.cashierName}</p>
                )}
              </div>

              {loadingDetail ? (
                <div className="animate-pulse space-y-5">
                  <div className="h-16 bg-slate-200 rounded-lg w-full" />
                  <div className="h-32 bg-slate-200 rounded-lg" />
                  <div className="h-20 bg-slate-200 rounded-lg w-full" />
                </div>
              ) : detail ? (
                <div className="space-y-6">
                  {/* Customer Info Card */}
                  <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      <User size={18} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 text-[13px]">
                        {detail.customer ? detail.customer.name : "Walk-in Customer"}
                      </p>
                      {detail.customer?.phone && (
                        <p className="text-[12px] text-slate-500 mt-0.5">{detail.customer.phone}</p>
                      )}
                    </div>
                  </div>

                  {/* Items List */}
                  <div>
                    <ul className="divide-y divide-slate-100">
                      {detail.items.map((item, idx) => (
                        <li key={idx} className="py-3 flex justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 text-[13px] truncate">{item.name}</p>
                            <p className="text-[12px] text-slate-500 mt-0.5">
                              {formatMinor(item.unitPriceMinor)} × {item.quantity}
                            </p>
                          </div>
                          <span className="font-medium text-slate-900 text-[13px]">{formatMinor(item.lineTotalMinor)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Totals Box */}
                  <div className="bg-slate-100/50 rounded-lg p-4 space-y-2.5 border border-slate-100">
                    <div className="flex justify-between text-[13px] text-slate-600">
                      <span>Subtotal</span>
                      <span className="font-medium text-slate-800">{formatMinor(detail.totalMinor)}</span>
                    </div>
                    <div className="flex justify-between text-[13px] text-slate-600">
                      <span>Discount</span>
                      <span className="font-medium text-emerald-600">-</span>
                    </div>
                    <div className="flex justify-between text-[13px] text-slate-600">
                      <span>GST</span>
                      <span className="font-medium text-slate-800">-</span>
                    </div>
                    <div className="border-t border-slate-200 my-2 pt-2 flex justify-between font-bold text-[15px] text-slate-900">
                      <span>Total</span>
                      <span>{formatMinor(detail.totalMinor)}</span>
                    </div>
                  </div>

                  {/* Payment Details */}
                  {detail.payments.length > 0 && (
                    <div>
                       <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Payment Method</h4>
                       {detail.payments.map((p, idx) => (
                         <div key={idx} className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500">
                             <WalletCards size={16} />
                           </div>
                           <div>
                             <p className="font-medium text-[13px] text-slate-800">{p.method}</p>
                             <p className="text-[12px] text-slate-500">{formatMinor(p.amountMinor)}</p>
                           </div>
                         </div>
                       ))}
                    </div>
                  )}
                  
                  {/* Additional Actions */}
                  <div className="pt-2 flex flex-col gap-2">
                    <button className="w-full inline-flex justify-center items-center gap-2 rounded-lg bg-blue-50 px-4 py-2.5 text-[13px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
                      <Printer size={16} />
                      Print Bill
                    </button>
                    <div className="flex gap-2">
                      <button className="flex-1 inline-flex justify-center items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors" disabled>
                        <RotateCcw size={16} className="text-slate-400" />
                        Return / Exchange
                      </button>
                      <Link
                        href={`/sales/${detail.id}`}
                        className="inline-flex justify-center items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors"
                        title="View Full Details"
                      >
                        <ChevronRight size={18} />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 text-center py-10">Failed to load details.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Trend */}
        <Card className="p-5 flex flex-col shadow-sm border border-slate-200 rounded-xl">
          <div className="flex justify-between items-start mb-6">
            <h3 className="text-[15px] font-bold text-slate-800 tracking-tight">Sales Trend</h3>
            <select className="text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none">
              <option>Last 7 Days</option>
            </select>
          </div>
          <div className="flex-1 min-h-[140px] flex items-end gap-2 px-1 pb-1">
            {analytics.trend.length === 0 ? (
              <div className="w-full text-center text-[13px] text-slate-400 self-center">No trend data</div>
            ) : (
              analytics.trend.map((t, i) => {
                const max = Math.max(...analytics.trend.map((x) => x.amountMinor), 1);
                const pct = (t.amountMinor / max) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end group relative h-full">
                    <div
                      className="w-full bg-blue-500 hover:bg-blue-600 rounded-sm transition-all relative"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                    >
                      {/* Tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[11px] px-2.5 py-1.5 rounded-md pointer-events-none whitespace-nowrap z-10 shadow-lg">
                        <div className="font-medium">{t.label}</div>
                        <div className="text-blue-200 mt-0.5">{formatMinor(t.amountMinor)}</div>
                        {/* Little triangle */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-2 font-medium">{t.label.split(" ")[0]}</span>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Payment Mix */}
        <Card className="p-5 flex flex-col shadow-sm border border-slate-200 rounded-xl">
          <h3 className="text-[15px] font-bold text-slate-800 tracking-tight mb-6">Payment Mode Breakdown</h3>
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-32 shrink-0">
              {/* CSS Donut approximation */}
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                {analytics.paymentMix.length === 0 ? (
                  <circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-100" strokeWidth="4" />
                ) : (
                  analytics.paymentMix.map((p, i) => {
                    const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                    const pct = (p.amountMinor / total) * 100;
                    
                    // Simple logic for colors based on index
                    const colors = ["#10b981", "#f43f5e", "#eab308", "#a855f7"];
                    const color = colors[i % colors.length];
                    
                    // Calculate offset
                    let offset = 0;
                    for (let j = 0; j < i; j++) {
                      offset += ((analytics.paymentMix[j]?.amountMinor ?? 0) / total) * 100;
                    }
                    const dashArray = `${pct} ${100 - pct}`;
                    const dashOffset = -offset;
                    
                    return (
                      <circle
                        key={p.method}
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke={color}
                        strokeWidth="4"
                        strokeDasharray={dashArray}
                        strokeDashoffset={dashOffset}
                        className="transition-all duration-500"
                      />
                    );
                  })
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                 <span className="font-bold text-slate-800 text-[13px]">{formatMinor(summary.totalMinor)}</span>
                 <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Total</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-3">
               {analytics.paymentMix.length === 0 ? (
                 <div className="text-[12px] text-slate-400">No data</div>
               ) : (
                 analytics.paymentMix.map((p, i) => {
                   const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                   const pct = (p.amountMinor / total) * 100;
                   const colors = ["bg-emerald-500", "bg-rose-500", "bg-yellow-500", "bg-purple-500"];
                   const colorClass = colors[i % colors.length];
                   return (
                     <div key={p.method} className="flex items-center justify-between text-[12px]">
                       <div className="flex items-center gap-2">
                         <div className={`w-2 h-2 rounded-full ${colorClass}`} />
                         <span className="font-medium text-slate-700">{p.method}</span>
                       </div>
                       <div className="flex items-center gap-3">
                         <span className="text-slate-400 font-medium w-8 text-right">{pct.toFixed(0)}%</span>
                         <span className="text-slate-800 font-semibold w-16 text-right">{formatMinor(p.amountMinor)}</span>
                       </div>
                     </div>
                   );
                 })
               )}
            </div>
          </div>
        </Card>

        {/* Transaction Types */}
        <Card className="p-5 flex flex-col shadow-sm border border-slate-200 rounded-xl">
          <h3 className="text-[15px] font-bold text-slate-800 tracking-tight mb-6">Transaction Type</h3>
          <div className="space-y-4">
            {analytics.typeMix.length === 0 ? (
               <div className="text-center text-[13px] text-slate-400 mt-8">No transaction data</div>
            ) : (
               analytics.typeMix.map(t => {
                 const total = analytics.typeMix.reduce((a, b) => a + b.count, 0);
                 const pct = (t.count / total) * 100;
                 return (
                   <div key={t.status}>
                     <div className="flex items-center justify-between text-[13px] mb-1.5">
                       <span className="font-semibold text-slate-700 capitalize">{t.status.toLowerCase()}</span>
                       <div className="flex items-center gap-3">
                         <span className="font-bold text-slate-900">{t.count}</span>
                         <span className="text-slate-400 font-medium w-8 text-right text-[12px]">{pct.toFixed(1)}%</span>
                       </div>
                     </div>
                     <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                       <div className={`h-full rounded-full ${t.status === "COMPLETED" ? "bg-slate-800" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
                     </div>
                   </div>
                 );
               })
            )}
            
            {/* Hardcoded placeholders for unsupported metrics in AMBURAX */}
            <div>
              <div className="flex items-center justify-between text-[13px] mb-1.5">
                <span className="font-semibold text-slate-400">Returns</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-400">0</span>
                  <span className="text-slate-300 font-medium w-8 text-right text-[12px]">0%</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-50 rounded-full" />
            </div>
            <div>
              <div className="flex items-center justify-between text-[13px] mb-1.5">
                <span className="font-semibold text-slate-400">Exchanges</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-400">0</span>
                  <span className="text-slate-300 font-medium w-8 text-right text-[12px]">0%</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-50 rounded-full" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
