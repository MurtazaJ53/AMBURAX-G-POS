"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fetchSaleDetailAction } from "../actions";
import { formatMinor } from "@/server/sales/saleTotals";
import type { SalesPage, SalesSummary, SalesAnalytics, SaleDetail } from "@/server/sales/saleQueries";
import {  Search, ChevronDown, Download, Calendar, Filter, FileText, IndianRupee, Store, MoreHorizontal, Receipt, X , User, Package, CreditCard } from "lucide-react";

interface SalesWorkspaceProps {
  page: SalesPage;
  summary: SalesSummary;
  analytics: SalesAnalytics;
  carriedParams: Record<string, string | undefined>;
}

export function SalesWorkspace({ page, summary, analytics, carriedParams }: SalesWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [selectedTxId, setSelectedTxId] = useState<string | null>(page.rows[0]?.id || null);
  const [txDetail, setTxDetail] = useState<SaleDetail | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);

  // Fetch full details when selected ID changes
  useEffect(() => {
    if (!selectedTxId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTxDetail(null);
      return;
    }
    let active = true;
    setLoadingTx(true);
    fetchSaleDetailAction(selectedTxId).then(detail => {
      if (active && detail) {
        setTxDetail(detail);
      }
      if (active) setLoadingTx(false);
    }).catch(() => {
      if (active) setLoadingTx(false);
    });
    
    return () => { active = false; };
  }, [selectedTxId]);

  const activeTxRow = page.rows.find((r) => r.id === selectedTxId) || page.rows[0];

  const handleTxSelect = (id: string) => {
    setSelectedTxId(id);
    const el = document.getElementById("inspector-scroll");
    if (el) el.scrollTop = 0;
  };

  const handleTabClick = (status?: string) => {
    const p = new URLSearchParams();
    if (carriedParams.q) p.set("q", carriedParams.q);
    if (carriedParams.method) p.set("method", carriedParams.method);
    if (carriedParams.from) p.set("from", carriedParams.from);
    if (carriedParams.to) p.set("to", carriedParams.to);
    if (status) p.set("status", status);
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      
      {/* KPI ROW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 shrink-0">
        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-subtle flex flex-col justify-between h-[80px]">
          <div className="flex justify-between items-start">
            <span className="text-[12px] font-medium text-slate-500">Total Sales</span>
            <div className="w-5 h-5 rounded bg-blue-50 text-blue-600 flex items-center justify-center"><IndianRupee size={12}/></div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold text-slate-900 leading-none">{formatMinor(summary.totalMinor)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-subtle flex flex-col justify-between h-[80px]">
          <div className="flex justify-between items-start">
            <span className="text-[12px] font-medium text-slate-500">Total Bills</span>
            <div className="w-5 h-5 rounded bg-purple-50 text-purple-600 flex items-center justify-center"><Receipt size={12}/></div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold text-slate-900 leading-none">{summary.billCount}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-subtle flex flex-col justify-between h-[80px]">
          <div className="flex justify-between items-start">
            <span className="text-[12px] font-medium text-slate-500">Returns / Exchanges</span>
            <div className="w-5 h-5 rounded bg-rose-50 text-rose-600 flex items-center justify-center"><FileText size={12}/></div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold text-slate-900 leading-none">—</span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium leading-none">Unavailable</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-subtle flex flex-col justify-between h-[80px]">
          <div className="flex justify-between items-start">
            <span className="text-[12px] font-medium text-slate-500">Avg. Bill Value</span>
            <div className="w-5 h-5 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center"><IndianRupee size={12}/></div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold text-slate-900 leading-none">{summary.averageBillMinor ? formatMinor(summary.averageBillMinor) : "—"}</span>
          </div>
        </div>
      </div>

      {/* FILTER ROW */}
      <div className="flex items-center gap-3 mb-4 shrink-0 flex-nowrap overflow-x-auto pb-1">
        <button className="flex items-center h-8 px-2.5 rounded border border-slate-200 text-[12px] bg-white shadow-sm shrink-0 font-medium text-slate-700 hover:bg-slate-50">
          <Calendar size={13} className="mr-1.5 text-slate-500" />
          All Time
          <ChevronDown size={13} className="ml-1.5 text-slate-400" />
        </button>
        <button className="flex items-center h-8 px-2.5 rounded border border-slate-200 text-[12px] bg-white shadow-sm shrink-0 font-medium text-slate-700 hover:bg-slate-50">
          All Stores
          <ChevronDown size={13} className="ml-1.5 text-slate-400" />
        </button>
        <button className="flex items-center h-8 px-2.5 rounded border border-slate-200 text-[12px] bg-white shadow-sm shrink-0 font-medium text-slate-700 hover:bg-slate-50">
          All Payment Modes
          <ChevronDown size={13} className="ml-1.5 text-slate-400" />
        </button>
        <button className="flex items-center h-8 px-2.5 rounded border border-slate-200 text-[12px] bg-white shadow-sm shrink-0 font-medium text-slate-700 hover:bg-slate-50">
          All Transaction Types
          <ChevronDown size={13} className="ml-1.5 text-slate-400" />
        </button>
        <div className="relative flex-1 min-w-[200px] shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            placeholder="Search by bill no, customer..." 
            className="w-full h-8 pl-8 pr-3 rounded border border-slate-200 text-[12px] bg-white shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" 
            defaultValue={carriedParams.q} 
          />
        </div>
        <button className="flex items-center h-8 px-2.5 rounded border border-slate-200 text-[12px] text-blue-600 bg-white shadow-sm shrink-0 font-medium hover:bg-blue-50">
          <Filter size={13} className="mr-1.5" /> More Filters
        </button>
        <button className="flex items-center h-8 px-2.5 rounded text-[12px] text-slate-500 shrink-0 font-medium hover:text-slate-700">
          Reset
        </button>
      </div>

      {/* TABS */}
      <div className="flex items-center gap-5 border-b border-slate-200 mb-3 shrink-0 px-2 overflow-x-auto">
        <button onClick={() => handleTabClick()} className={`pb-2.5 text-[12px] font-semibold whitespace-nowrap ${!carriedParams.status ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          All Transactions ({summary.billCount})
        </button>
        <button onClick={() => handleTabClick("COMPLETED")} className={`pb-2.5 text-[12px] font-semibold whitespace-nowrap ${carriedParams.status === 'COMPLETED' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          Completed
        </button>
        <button onClick={() => handleTabClick("VOIDED")} className={`pb-2.5 text-[12px] font-semibold whitespace-nowrap ${carriedParams.status === 'VOIDED' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          Voided
        </button>
        <button disabled className="pb-2.5 text-[12px] font-medium text-slate-300 cursor-not-allowed whitespace-nowrap">Returns (0)</button>
        <button disabled className="pb-2.5 text-[12px] font-medium text-slate-300 cursor-not-allowed whitespace-nowrap">Exchanges (0)</button>
        <button disabled className="pb-2.5 text-[12px] font-medium text-slate-300 cursor-not-allowed whitespace-nowrap">Drafts (0)</button>
      </div>

      {/* TABLE + INSPECTOR WORKSPACE */}
      <div className="flex flex-col lg:flex-row gap-5 mb-5 h-[480px] shrink-0">
        
        {/* Table Area */}
        <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-lg shadow-sm min-w-0 overflow-hidden h-full">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
                <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                  <th className="px-3 py-2 font-semibold w-10 text-center"><input type="checkbox" className="rounded border-slate-300 text-blue-600 cursor-pointer" /></th>
                  <th className="px-1 py-2 font-semibold w-8">#</th>
                  <th className="px-3 py-2 font-semibold">Date & Time</th>
                  <th className="px-3 py-2 font-semibold">Bill No.</th>
                  <th className="px-3 py-2 font-semibold max-w-[140px] truncate">Customer</th>
                  <th className="px-3 py-2 font-semibold text-center">Items</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Payment</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.rows.map((row, i) => (
                  <tr 
                    key={row.id} 
                    onClick={() => handleTxSelect(row.id)}
                    className={`hover:bg-slate-50 cursor-pointer transition-colors ${selectedTxId === row.id ? 'bg-blue-50/50' : ''}`}
                  >
                    <td className="px-3 py-1.5 text-center"><input type="checkbox" className="rounded border-slate-300 text-blue-600 cursor-pointer" /></td>
                    <td className="px-1 py-1.5 text-[11px] font-medium text-slate-400">{(page.page - 1) * 20 + i + 1}</td>
                    <td className="px-3 py-1.5 text-[12px] text-slate-600">
                      {row.completedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, {row.completedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-medium text-blue-600">{row.billNumber}</td>
                    <td className="px-3 py-1.5 text-[12px] text-slate-700 truncate max-w-[140px]">{row.customerName || "Walk-in Customer"}</td>
                    <td className="px-3 py-1.5 text-[12px] text-slate-600 text-center">{row.itemsCount}</td>
                    <td className="px-3 py-1.5 text-[12px] font-medium text-slate-900 text-right">{formatMinor(row.totalMinor)}</td>
                    <td className="px-3 py-1.5 text-[12px] text-slate-600">{row.paymentMethod || "Unknown"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        row.status === "COMPLETED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-medium text-blue-600">View</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50 shrink-0">
            <span className="text-[11px] text-slate-500">
              Showing {(page.page - 1) * 20 + 1}-{Math.min(page.page * 20, page.total)} of {page.total}
            </span>
            <div className="flex gap-1.5">
               <button className="h-6 px-2.5 rounded border border-slate-200 text-[10px] font-medium bg-white disabled:opacity-50" disabled={page.page <= 1}>Previous</button>
               <button className="h-6 px-2.5 rounded border border-slate-200 text-[10px] font-medium bg-white disabled:opacity-50" disabled={page.page >= page.pageCount}>Next</button>
            </div>
          </div>
        </div>

        
        {/* Inspector Area (approx 300px fixed) */}
        <div className="w-full lg:w-[300px] shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden relative">
          {activeTxRow ? (
            <>
              {/* Fixed Header */}
              <div className="px-4 py-3 border-b border-slate-200 shrink-0 bg-white z-10 flex justify-between items-center">
                <h2 className="text-[14.5px] font-bold text-slate-900 tracking-tight">Transaction Details</h2>
                <button className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>
              
              {/* Scrollable Content */}
              <div id="inspector-scroll" className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                
                {/* Transaction Meta */}
                <div className="flex justify-between items-start mb-1.5">
                  <span className="text-[16px] font-bold text-slate-900 leading-none">{txDetail?.billNumber || activeTxRow.billNumber}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                        activeTxRow.status === "COMPLETED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                      }`}>
                        {activeTxRow.status}
                  </span>
                </div>
                <div className="text-[11.5px] text-slate-500 mb-0.5 font-medium">
                  {activeTxRow.completedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, {activeTxRow.completedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[11.5px] text-slate-500 mb-4 font-medium">Cashier: {txDetail?.cashierName || activeTxRow.cashierName}</div>
                
                {/* Customer Block */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 flex items-center gap-2.5 mb-5">
                  <div className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                    <User size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-slate-800 truncate">{txDetail?.customer?.name || activeTxRow.customerName || "Walk-in Customer"}</p>
                    {txDetail?.customer?.phone && <p className="text-[11px] text-slate-500">{txDetail.customer.phone}</p>}
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-3 mb-5">
                  {txDetail ? (
                    txDetail.items.map(item => (
                      <div key={item.id} className="flex gap-2.5 items-start">
                        {item.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={item.imageUrl} alt={item.name} className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0 bg-white" />
                        ) : (
                          <div className="w-9 h-9 rounded bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center text-slate-300">
                            <Package size={16} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-start gap-2 mb-0.5">
                            <p className="text-[12px] font-medium text-slate-800 leading-snug truncate">{item.name}</p>
                            <span className="text-[12px] font-bold text-slate-900 shrink-0">{formatMinor(item.lineTotalMinor)}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-medium">{formatMinor(item.unitPriceMinor)} × {item.quantity}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-center p-4">
                      <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 mb-4" />

                {/* Totals */}
                <div className="space-y-2 mb-5 text-[12px]">
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Subtotal</span>
                    <span>{txDetail ? formatMinor(txDetail.subtotalMinor) : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Discount</span>
                    <span>{txDetail && txDetail.discountMinor > 0 ? `-${formatMinor(txDetail.discountMinor)}` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>GST</span>
                    <span>{txDetail ? formatMinor(txDetail.taxMinor) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2.5 mt-2.5 border-t border-slate-100">
                    <span className="font-bold text-[13px] text-slate-800">Total</span>
                    <span className="font-bold text-[16px] text-slate-900">{formatMinor(activeTxRow.totalMinor)}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 mb-4" />

                {/* Payment Method */}
                <div className="mb-2">
                  <h3 className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">Payment Method</h3>
                  {(txDetail?.payments || []).length > 0 ? (
                    txDetail!.payments.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[12px] mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                            <CreditCard size={12} />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-700">{p.method}</p>
                            {p.reference && <p className="text-[10px] text-slate-400 font-medium mt-0.5">Ref: {p.reference}</p>}
                          </div>
                        </div>
                        <span className="font-semibold text-slate-900">{formatMinor(p.amountMinor)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                          <CreditCard size={12} />
                        </div>
                        <p className="font-semibold text-slate-700">{activeTxRow.paymentMethod || "Unknown"}</p>
                      </div>
                      <span className="font-semibold text-slate-900">{formatMinor(activeTxRow.totalMinor)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sticky Actions */}
              <div className="p-3 border-t border-slate-200 shrink-0 bg-slate-50 flex gap-2">
                <button className="flex items-center justify-center h-[34px] flex-1 rounded-md border border-slate-200 text-[12px] font-semibold bg-white text-slate-700 hover:bg-slate-50 shadow-sm">
                  <Receipt size={14} className="mr-1.5" /> Print Bill
                </button>
                <button className="flex items-center justify-center h-[34px] flex-1 rounded-md border border-slate-200 text-[12px] font-semibold bg-slate-50 text-slate-400 cursor-not-allowed">
                  Return
                </button>
                <button className="flex items-center justify-center h-[34px] w-[34px] rounded-md border border-slate-200 shrink-0 text-slate-400 bg-white shadow-sm cursor-not-allowed">
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <span className="text-[13px] font-medium">Select a transaction</span>
            </div>
          )}
        </div>

      </div>

      {/* ANALYTICS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0 pb-2">
        
        {/* Sales Trend */}
        <div className="bg-white p-3.5 flex flex-col shadow-sm border border-slate-200 rounded-lg h-[220px] min-w-0">
          <div className="flex justify-between items-center mb-4 shrink-0">
            <h3 className="text-[13px] font-bold text-slate-900 tracking-tight">Sales Trend</h3>
            <button className="flex items-center h-6 px-2 rounded border border-slate-200 text-[10px] font-medium bg-white text-slate-600">
              Last 7 Days <ChevronDown size={11} className="ml-1" />
            </button>
          </div>
          <div className="flex-1 flex items-end justify-between gap-1.5 mt-1 min-h-0 w-full overflow-hidden px-1">
            {analytics.trend.length === 0 ? (
              <div className="w-full text-center text-[11px] text-slate-400 self-center">No trend data</div>
            ) : (
              analytics.trend.map((t, i) => {
                const max = Math.max(...analytics.trend.map((x) => x.amountMinor), 1);
                const pct = (t.amountMinor / max) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end group relative h-full w-full min-w-0">
                    <div
                      className="w-full max-w-[32px] bg-blue-500 hover:bg-blue-600 rounded-sm transition-all relative mx-auto"
                      style={{ height: `${Math.max(pct, 2)}%` }}
                    >
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        <div className="font-medium">{t.label}</div>
                        <div className="text-blue-200 mt-0.5">{formatMinor(t.amountMinor)}</div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-400 mt-2 font-medium truncate w-full text-center shrink-0 px-0.5">{t.label.split(" ")[0]}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Payment Mix */}
        <div className="bg-white p-3.5 flex flex-col shadow-sm border border-slate-200 rounded-lg h-[220px] min-w-0">
          <h3 className="text-[13px] font-bold text-slate-900 tracking-tight mb-4 shrink-0">Payment Mode Breakdown</h3>
          <div className="flex items-center gap-5 flex-1 min-h-0 justify-center">
            <div className="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                {analytics.paymentMix.length === 0 ? (
                  <circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-100" strokeWidth="4" />
                ) : (
                  analytics.paymentMix.map((p, i) => {
                    const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                    const pct = (p.amountMinor / total) * 100;
                    const colors = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7"];
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
                 <span className="font-bold text-slate-900 text-[12px]">{formatMinor(summary.totalMinor)}</span>
                 <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">Total</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-2.5">
               {analytics.paymentMix.length === 0 ? (
                 <div className="text-[11px] text-slate-400">No data</div>
               ) : (
                 analytics.paymentMix.map((p, i) => {
                   const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
                   const pct = (p.amountMinor / total) * 100;
                   const colors = ["bg-emerald-500", "bg-blue-500", "bg-yellow-500", "bg-purple-500"];
                   return (
                     <div key={p.method} className="flex items-center justify-between text-[11px]">
                       <div className="flex items-center gap-1.5">
                         <div className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                         <span className="font-medium text-slate-700">{p.method}</span>
                       </div>
                       <div className="flex items-center gap-2">
                         <span className="text-slate-400 font-medium w-7 text-right text-[10px]">{pct.toFixed(0)}%</span>
                         <span className="text-slate-900 font-semibold w-14 text-right">{formatMinor(p.amountMinor)}</span>
                       </div>
                     </div>
                   );
                 })
               )}
            </div>
          </div>
        </div>

        {/* Transaction Types */}
        <div className="bg-white p-3.5 flex flex-col shadow-sm border border-slate-200 rounded-lg h-[220px] min-w-0">
          <h3 className="text-[13px] font-bold text-slate-900 tracking-tight mb-4 shrink-0">Transaction Type</h3>
          <div className="space-y-3 flex-1 flex flex-col justify-center min-h-0 px-2">
            {analytics.typeMix.length === 0 ? (
               <div className="text-center text-[11px] text-slate-400">No data</div>
            ) : (
               analytics.typeMix.map(t => {
                 const total = analytics.typeMix.reduce((a, b) => a + b.count, 0);
                 const pct = (t.count / total) * 100;
                 return (
                   <div key={t.status}>
                     <div className="flex items-center justify-between text-[11px] mb-1.5">
                       <span className="font-semibold text-slate-700 capitalize">{t.status.toLowerCase()}</span>
                       <div className="flex items-center gap-3">
                         <span className="font-bold text-slate-900">{t.count}</span>
                         <span className="text-slate-400 font-medium w-7 text-right text-[10px]">{pct.toFixed(1)}%</span>
                       </div>
                     </div>
                     <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                       <div className={`h-full rounded-full ${t.status === "COMPLETED" ? "bg-blue-600" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
                     </div>
                   </div>
                 );
               })
            )}
            
            <div className="opacity-50 pt-1">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="font-semibold text-slate-400">Returns</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-400">—</span>
                  <span className="text-slate-400 font-medium w-12 text-right text-[9px]">Unavailable</span>
                </div>
              </div>
              <div className="h-1 w-full bg-slate-50 rounded-full" />
            </div>
            <div className="opacity-50">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="font-semibold text-slate-400">Exchanges</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-400">—</span>
                  <span className="text-slate-400 font-medium w-12 text-right text-[9px]">Unavailable</span>
                </div>
              </div>
              <div className="h-1 w-full bg-slate-50 rounded-full" />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
