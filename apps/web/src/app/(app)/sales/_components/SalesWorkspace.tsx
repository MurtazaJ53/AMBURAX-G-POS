"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchSaleDetailAction } from "../actions";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../formatDateTime";
import type { SalesPage, SalesSummary, SalesAnalytics, SaleListRow } from "@/server/sales/saleQueries";
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
  Filter,
  FileText
} from "lucide-react";
import {
  Card,
  StatusBadge,
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
  { id: "all", label: "All Transactions (296)" },
  { id: "COMPLETED", label: "Completed" },
  { id: "VOIDED", label: "Voided" },
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
    <div className="space-y-4">
      {/* 1. KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Sales */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3.5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <ShoppingCart size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Total Sales</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold text-slate-900">{formatMinor(summary.totalMinor)}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">vs previous period</p>
          </div>
        </div>

        {/* KPI 2: Bills */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3.5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center shrink-0">
            <Receipt size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Total Bills</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold text-slate-900">{summary.billCount}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">vs previous period</p>
          </div>
        </div>

        {/* KPI 3: Returns */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3.5 flex items-start gap-3 opacity-70">
          <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
            <RotateCcw size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Returns / Exchanges</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold text-slate-900">—</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Unavailable</p>
          </div>
        </div>

        {/* KPI 4: Avg Bill */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3.5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
            <WalletCards size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Avg. Bill Value</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold text-slate-900">{summary.averageBillMinor === null ? "—" : formatMinor(summary.averageBillMinor)}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">vs previous period</p>
          </div>
        </div>
      </div>

      {/* 2. Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm text-sm">
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          {/* Date Picker (Pseudo) */}
          <div className="flex items-center gap-1.5 border border-slate-200 rounded px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-blue-500 bg-white">
            <CalendarDays size={14} className="text-blue-500" />
            <input
              type="date"
              className="bg-transparent text-slate-700 outline-none text-[12px] w-[95px]"
              value={from}
              onChange={(e) => updateFilters({ from: e.target.value })}
              aria-label="From Date"
            />
            <span className="text-slate-300">-</span>
            <input
              type="date"
              className="bg-transparent text-slate-700 outline-none text-[12px] w-[95px]"
              value={to}
              onChange={(e) => updateFilters({ to: e.target.value })}
              aria-label="To Date"
            />
            <button className="ml-1 text-slate-400 hover:text-slate-600" onClick={() => updateFilters({ from: undefined, to: undefined })} title="Clear Dates">
              <X size={14} />
            </button>
          </div>

          {/* Payment Mode */}
          <select
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
            value={method}
            onChange={(e) => updateFilters({ method: e.target.value === "all" ? undefined : e.target.value })}
          >
            <option value="all">All Payment Modes</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>

          {/* Transaction Type */}
          <select
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
            value={statusTab}
            onChange={(e) => updateFilters({ status: e.target.value === "all" ? undefined : e.target.value })}
          >
            <option value="all">All Transaction Types</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </select>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto flex-1 lg:flex-none justify-end">
          {/* Search */}
          <div className="relative flex-1 lg:w-64 max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="w-full rounded border border-slate-200 py-1.5 pl-8 pr-8 text-[12px] text-slate-700 outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400"
              placeholder="Search by bill no, customer, product..."
              value={q}
              onChange={(e) => updateFilters({ q: e.target.value })}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-medium text-slate-400">
              ⌘K
            </div>
          </div>

          <button className="flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap">
            <Filter size={14} />
            More Filters
          </button>
          
          {(q || method || from || to || statusTab !== "all") && (
            <button
              onClick={() => router.push(pathname)}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-700 hover:underline whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 3. Tabs */}
      <div className="border-b border-slate-200 mt-2">
        <nav className="-mb-px flex space-x-6 px-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => updateFilters({ status: tab.id === "all" ? undefined : tab.id })}
              className={`whitespace-nowrap border-b-2 py-2 px-1 text-[12px] font-medium tracking-wide transition-colors ${
                statusTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {tab.label.replace(" (296)", tab.id === "all" ? ` (${summary.billCount})` : "")}
            </button>
          ))}
          {/* Mock tabs from reference just for visual layout density matching, but rendered distinctly as unsupported */}
          <div className="flex gap-4 items-center opacity-50 ml-4 pointer-events-none">
            <span className="text-[12px] font-medium text-slate-400">Returns (0)</span>
            <span className="text-[12px] font-medium text-slate-400">Exchanges (0)</span>
            <span className="text-[12px] font-medium text-slate-400">Drafts (0)</span>
          </div>
        </nav>
      </div>

      {/* 4. Main Workspace Split (Table + Inspector) */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch h-full">
        
        {/* Left: Table */}
        <div className="flex-1 w-full min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
          {page.rows.length === 0 ? (
            <div className="flex-1 min-h-[300px]">
              <EmptyState title="No sales found" description="No transactions match the current filters." />
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 z-10">
                    <tr>
                      <th className="w-10 px-3 py-2 text-center font-semibold">
                        <input type="checkbox" disabled className="rounded border-slate-300 text-blue-600" />
                      </th>
                      <th className="px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Date & Time</th>
                      <th className="px-3 py-2 font-semibold">Bill No.</th>
                      <th className="px-3 py-2 font-semibold">Customer</th>
                      <th className="px-3 py-2 font-semibold text-right">Amount</th>
                      <th className="px-3 py-2 font-semibold">Payment Mode</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[12px]">
                    {page.rows.map((row, index) => (
                      <tr
                        key={row.id}
                        onClick={() => handleRowClick(row)}
                        className={`cursor-pointer transition-colors ${
                          selectedSale?.id === row.id ? "bg-blue-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" disabled className="rounded border-slate-300 text-blue-600 opacity-50" />
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 font-medium">
                          {((page.page - 1) * 20) + index + 1}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                          {formatDateTime(row.completedAt)}
                        </td>
                        <td className="px-3 py-1.5 font-medium text-blue-600">{row.billNumber}</td>
                        <td className="px-3 py-1.5 text-slate-700">{row.customerName ?? "Walk-in Customer"}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900 text-right">{formatMinor(row.totalMinor)}</td>
                        <td className="px-3 py-1.5 text-slate-600">{row.paymentMethod ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {row.status === "VOIDED" ? (
                            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">Voided</span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Paid</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-blue-600 hover:text-blue-800">
                          View
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 flex items-center justify-between shrink-0">
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

        {/* Right: Inspector Slide-over */}
        <div className="w-full lg:w-[360px] shrink-0 lg:h-[500px] flex flex-col relative overflow-hidden bg-white shadow-sm border border-slate-200 rounded-xl">
          {selectedSale ? (
            <>
              {/* Inspector Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-white shrink-0">
                <h3 className="font-bold text-slate-800 text-[13px]">Transaction Details</h3>
                <button
                  onClick={() => setSelectedSale(null)}
                  className="rounded p-1 hover:bg-slate-100 text-slate-400 transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto px-4 py-3 text-sm bg-slate-50/50">
                {/* Sticky Summary Header */}
                <div className="mb-4">
                  <div className="flex justify-between items-start mb-1">
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">{selectedSale.billNumber}</h2>
                    {selectedSale.status === "VOIDED" ? (
                      <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">Voided</span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Paid</span>
                    )}
                  </div>
                  <p className="text-[12px] text-slate-500 mb-0.5">{formatDateTime(selectedSale.completedAt)}</p>
                  {selectedSale.cashierName && (
                    <p className="text-[12px] text-slate-500">Cashier: {selectedSale.cashierName}</p>
                  )}
                </div>

                {loadingDetail ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-12 bg-slate-200 rounded-lg w-full" />
                    <div className="h-24 bg-slate-200 rounded-lg" />
                    <div className="h-16 bg-slate-200 rounded-lg w-full" />
                  </div>
                ) : detail ? (
                  <div className="space-y-4">
                    {/* Customer Info Card */}
                    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                        <User size={16} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-[12px]">
                          {detail.customer ? detail.customer.name : "Walk-in Customer"}
                        </p>
                        {detail.customer?.phone && (
                          <p className="text-[11px] text-slate-500 mt-0.5">{detail.customer.phone}</p>
                        )}
                      </div>
                    </div>

                    {/* Items List */}
                    <div>
                      <ul className="divide-y divide-slate-100 border-t border-slate-100">
                        {detail.items.map((item, idx) => (
                          <li key={idx} className="py-2.5 flex justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800 text-[12px] truncate">{item.name}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {formatMinor(item.unitPriceMinor)} × {item.quantity}
                              </p>
                            </div>
                            <span className="font-medium text-slate-900 text-[12px] whitespace-nowrap">{formatMinor(item.lineTotalMinor)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Totals Box */}
                    <div className="bg-slate-100/50 rounded-lg p-3 space-y-2 border border-slate-100">
                      <div className="flex justify-between text-[12px] text-slate-600">
                        <span>Subtotal</span>
                        <span className="font-medium text-slate-800">{formatMinor(detail.totalMinor)}</span>
                      </div>
                      <div className="flex justify-between text-[12px] text-slate-600">
                        <span>Discount</span>
                        <span className="font-medium text-emerald-600">-</span>
                      </div>
                      <div className="flex justify-between text-[12px] text-slate-600">
                        <span>GST</span>
                        <span className="font-medium text-slate-800">-</span>
                      </div>
                      <div className="border-t border-slate-200 my-1.5 pt-1.5 flex justify-between font-bold text-[14px] text-slate-900">
                        <span>Total</span>
                        <span>{formatMinor(detail.totalMinor)}</span>
                      </div>
                    </div>

                    {/* Payment Details */}
                    {detail.payments.length > 0 && (
                      <div>
                         <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Payment Method</h4>
                         {detail.payments.map((p, idx) => (
                           <div key={idx} className="flex items-center gap-2.5 mb-2">
                             <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-500">
                               <WalletCards size={14} />
                             </div>
                             <div>
                               <p className="font-medium text-[12px] text-slate-800">{p.method}</p>
                               <p className="text-[11px] text-slate-500">{formatMinor(p.amountMinor)}</p>
                             </div>
                           </div>
                         ))}
                      </div>
                    )}
                    
                    {/* Additional Actions */}
                    <div className="pt-2 flex flex-col gap-2 pb-2">
                      <button className="w-full inline-flex justify-center items-center gap-1.5 rounded bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
                        <Printer size={14} />
                        Print Bill
                      </button>
                      <div className="flex gap-2">
                        <button className="flex-1 inline-flex justify-center items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors opacity-50 cursor-not-allowed">
                          <RotateCcw size={14} className="text-slate-400" />
                          Return / Exchange
                        </button>
                        <Link
                          href={`/sales/${detail.id}`}
                          className="inline-flex justify-center items-center rounded border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
                          title="View Full Details"
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-center py-10">Failed to load details.</p>
                )}
              </div>
            </>
          ) : (
            /* Empty State for Inspector */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
                <FileText size={24} className="text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-800 text-[13px] mb-1">Transaction Details</h3>
              <p className="text-[12px]">Select a transaction to view details.</p>
            </div>
          )}
        </div>
      </div>

      {/* 5. Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend */}
        <div className="bg-white p-4 flex flex-col shadow-sm border border-slate-200 rounded-xl h-[240px]">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-[14px] font-bold text-slate-800 tracking-tight">Sales Trend</h3>
            <select className="text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded px-1.5 py-1 outline-none">
              <option>Last 7 Days</option>
            </select>
          </div>
          <div className="flex-1 flex items-end gap-1.5 px-1 pb-1">
            {analytics.trend.length === 0 ? (
              <div className="w-full text-center text-[12px] text-slate-400 self-center">No trend data</div>
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
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10 shadow-lg">
                        <div className="font-medium">{t.label}</div>
                        <div className="text-blue-200 mt-0.5">{formatMinor(t.amountMinor)}</div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-400 mt-1.5 font-medium">{t.label.split(" ")[0]}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Payment Mix */}
        <div className="bg-white p-4 flex flex-col shadow-sm border border-slate-200 rounded-xl h-[240px]">
          <h3 className="text-[14px] font-bold text-slate-800 tracking-tight mb-4">Payment Mode Breakdown</h3>
          <div className="flex items-center gap-5 flex-1">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                {analytics.paymentMix.length === 0 ? (
                  <circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-100" strokeWidth="4" />
                ) : (
                  analytics.paymentMix.map((p, i) => {
                    const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                    const pct = (p.amountMinor / total) * 100;
                    const colors = ["#10b981", "#f43f5e", "#eab308", "#a855f7"];
                    const color = colors[i % colors.length];
                    let offset = 0;
                    for (let j = 0; j < i; j++) {
                      offset += ((analytics.paymentMix[j]?.amountMinor ?? 0) / total) * 100;
                    }
                    return (
                      <circle
                        key={p.method}
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke={color}
                        strokeWidth="4"
                        strokeDasharray={`${pct} ${100 - pct}`}
                        strokeDashoffset={-offset}
                        className="transition-all duration-500"
                      />
                    );
                  })
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                 <span className="font-bold text-slate-800 text-[11px]">{formatMinor(summary.totalMinor)}</span>
                 <span className="text-[8px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Total</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-2.5">
               {analytics.paymentMix.length === 0 ? (
                 <div className="text-[11px] text-slate-400">No data</div>
               ) : (
                 analytics.paymentMix.map((p, i) => {
                   const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                   const pct = (p.amountMinor / total) * 100;
                   const colors = ["bg-emerald-500", "bg-rose-500", "bg-yellow-500", "bg-purple-500"];
                   return (
                     <div key={p.method} className="flex items-center justify-between text-[11px]">
                       <div className="flex items-center gap-1.5">
                         <div className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                         <span className="font-medium text-slate-700">{p.method}</span>
                       </div>
                       <div className="flex items-center gap-2">
                         <span className="text-slate-400 font-medium w-6 text-right">{pct.toFixed(0)}%</span>
                         <span className="text-slate-800 font-semibold w-14 text-right">{formatMinor(p.amountMinor)}</span>
                       </div>
                     </div>
                   );
                 })
               )}
            </div>
          </div>
        </div>

        {/* Transaction Types */}
        <div className="bg-white p-4 flex flex-col shadow-sm border border-slate-200 rounded-xl h-[240px]">
          <h3 className="text-[14px] font-bold text-slate-800 tracking-tight mb-4">Transaction Type</h3>
          <div className="space-y-3 flex-1 flex flex-col justify-center">
            {analytics.typeMix.length === 0 ? (
               <div className="text-center text-[12px] text-slate-400">No data</div>
            ) : (
               analytics.typeMix.map(t => {
                 const total = analytics.typeMix.reduce((a, b) => a + b.count, 0);
                 const pct = (t.count / total) * 100;
                 return (
                   <div key={t.status}>
                     <div className="flex items-center justify-between text-[11px] mb-1">
                       <span className="font-semibold text-slate-700 capitalize">{t.status.toLowerCase()}</span>
                       <div className="flex items-center gap-2">
                         <span className="font-bold text-slate-900">{t.count}</span>
                         <span className="text-slate-400 font-medium w-6 text-right text-[10px]">{pct.toFixed(1)}%</span>
                       </div>
                     </div>
                     <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                       <div className={`h-full rounded-full ${t.status === "COMPLETED" ? "bg-slate-800" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
                     </div>
                   </div>
                 );
               })
            )}
            
            {/* Hardcoded placeholders */}
            <div className="opacity-60">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-semibold text-slate-400">Returns</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400">—</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-50 rounded-full" />
            </div>
            <div className="opacity-60">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-semibold text-slate-400">Exchanges</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400">—</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-50 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
