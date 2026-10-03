const fs = require('fs');

const code = `
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ArrowDownToLine, Filter, X, UserRound, Search, CreditCard, ShoppingCart, Receipt, RotateCcw, Wallet, MoreHorizontal, RefreshCcw } from "lucide-react";

import { fetchSaleDetailAction } from "../actions";
import { formatMinor } from "@/server/sales/saleTotals";
import type { SalesPage, SalesSummary, SalesAnalytics, SaleDetail, SaleListRow } from "@/server/sales/saleQueries";

interface SalesWorkspaceProps {
  page: SalesPage;
  summary: SalesSummary;
  analytics: SalesAnalytics;
  carriedParams: Record<string, string | undefined>;
}

function StatusPill({ status }: { status: string }) {
  if (status === "COMPLETED") return <span className="amb-pill bg-emerald-100 text-emerald-700">Completed</span>;
  if (status === "VOIDED") return <span className="amb-pill bg-slate-200 text-slate-600">Voided</span>;
  return <span className="amb-pill bg-slate-100 text-slate-600">{status}</span>;
}

export function SalesWorkspace({ page, summary, analytics, carriedParams }: SalesWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [selectedTxId, setSelectedTxId] = useState<string | null>(page.rows[0]?.id || null);
  const [txDetail, setTxDetail] = useState<SaleDetail | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const handleNotice = (text: string) => { 
    setNotice(text); 
    window.setTimeout(() => setNotice(""), 2600); 
  };

  useEffect(() => {
    setInspectorOpen(window.innerWidth >= 768 && page.rows.length > 0);
  }, [page.rows.length]);

  useEffect(() => {
    if (!selectedTxId) {
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

  const handleSelect = (id: string) => {
    setSelectedTxId(id);
    setInspectorOpen(true);
  };

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page"); // reset page on filter change
    router.push(\`\${pathname}?\${next.toString()}\`);
  };

  const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParam("q", e.target.value);
  };

  // KPIs
  const kpis = [
    { label: "Total Sales", value: formatMinor(summary.totalMinor), icon: <ShoppingCart size={14} className="text-blue-500" /> },
    { label: "Total Bills", value: summary.billCount.toString(), icon: <Receipt size={14} className="text-violet-500" /> },
    { label: "Unposted (ERP)", value: summary.unpostedCount.toString(), icon: <RotateCcw size={14} className="text-rose-500" /> },
    { label: "Avg. Bill Value", value: summary.averageBillMinor ? formatMinor(summary.averageBillMinor) : "—", icon: <Wallet size={14} className="text-emerald-500" /> },
  ];

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
            <Link href="/" className="text-[hsl(var(--primary))] hover:underline">Operations</Link>
            <ChevronRight size={12} /> Sales
          </div>
          <h1 className="page-heading text-[25px] font-bold tracking-[-.045em] text-[#243b58]">Sales &amp; Transaction History</h1>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">View, search and manage all your sales, returns and transactions</p>
        </div>
        <button className="amb-control mt-5 font-bold text-[hsl(var(--primary))]" onClick={() => handleNotice("Export prepared locally.")}>
          <ArrowDownToLine size={14} /> Export
        </button>
      </div>

      <section className="kpi-grid mb-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((item) => (
          <div className="amb-card kpi-card p-4 min-w-0" key={item.label}>
            <div className="flex items-center gap-2 mb-2">
              <span className="grid h-6 w-6 place-items-center rounded bg-slate-100">{item.icon}</span>
              <h3 className="amb-label m-0">{item.label}</h3>
            </div>
            <div className="flex items-baseline gap-2">
              <div className="kpi-value text-[22px] font-bold tracking-[-.04em] text-slate-800 truncate">{item.value}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="hidden text-[11px] font-bold text-[#425a73] md:block">Transaction workspace</div>
        <button className="amb-control amb-mobile-only ml-auto" onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}>
          <Filter size={13} /> Filters
        </button>
      </div>

      <div className={\`\${mobileFiltersOpen ? "block" : "hidden"} mb-3 md:block\`}>
        <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-md border border-[hsl(var(--border))]">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              className="w-full bg-slate-50 border border-slate-200 rounded px-8 py-1.5 text-[11px] outline-none focus:border-blue-500 transition-colors"
              placeholder="Search by Bill No or Customer..." 
              value={carriedParams.q || ""}
              onChange={onSearch}
            />
          </div>
          <select className="amb-control" value={carriedParams.method || ""} onChange={e => setParam("method", e.target.value)}>
            <option value="">All Payments</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>
          <select className="amb-control" value={carriedParams.status || ""} onChange={e => setParam("status", e.target.value)}>
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </select>
          <input type="date" className="amb-control" value={carriedParams.from || ""} onChange={e => setParam("from", e.target.value)} title="From Date" />
          <span className="text-[10px] text-slate-400">to</span>
          <input type="date" className="amb-control" value={carriedParams.to || ""} onChange={e => setParam("to", e.target.value)} title="To Date" />
          <button className="text-[10px] text-blue-600 font-medium hover:underline ml-1" onClick={() => router.push(pathname)}>Reset</button>
        </div>
      </div>

      <div className="tabs-scroll mb-0 flex border-b border-[hsl(var(--border))]" role="tablist">
        <button className={\`amb-tab \${!carriedParams.status ? "active" : ""}\`} onClick={() => setParam("status", "")} role="tab">All Transactions</button>
        <button className={\`amb-tab \${carriedParams.status === "COMPLETED" ? "active" : ""}\`} onClick={() => setParam("status", "COMPLETED")} role="tab">Sales</button>
        <button className={\`amb-tab \${carriedParams.status === "VOIDED" ? "active" : ""}\`} onClick={() => setParam("status", "VOIDED")} role="tab">Voided</button>
        <button className="amb-tab opacity-50 cursor-not-allowed" title="Future Feature">Returns</button>
      </div>

      <div className={\`amb-card flex min-h-[476px] min-w-0 overflow-hidden rounded-t-none\`}>
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="amb-table-wrap flex-1">
            <table className="amb-table">
              <thead>
                <tr>
                  <th className="w-[34px] text-center"><input type="checkbox" /></th>
                  <th className="w-[34px]">#</th>
                  <th className="w-[126px]">Date &amp; Time</th>
                  <th className="w-[98px]">Bill No.</th>
                  <th>Customer</th>
                  <th className="w-[52px]">Items</th>
                  <th className="w-[78px] text-right">Amount</th>
                  <th className="w-[83px]">Payment</th>
                  <th className="w-[74px]">Status</th>
                  <th className="w-[43px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-500">No transactions found</td></tr>
                )}
                {page.rows.map((row, index) => {
                  const localDate = new Date(row.completedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
                  return (
                    <tr className={row.id === selectedTxId ? "selected" : ""} key={row.id} onClick={() => handleSelect(row.id)}>
                      <td className="text-center"><input type="checkbox" checked={row.id === selectedTxId} readOnly /></td>
                      <td className="amb-number text-[hsl(var(--muted-foreground))]">{(page.page - 1) * 20 + index + 1}</td>
                      <td className="text-[10px] text-[#5e7187]">{localDate}</td>
                      <td><button className="font-mono text-[10px] font-bold text-[hsl(var(--primary))] hover:underline">{row.billNumber}</button></td>
                      <td className="font-medium text-[#3b526c]" title={row.customerName ?? "Walk-in Customer"}>{row.customerName ?? "Walk-in"}</td>
                      <td className="amb-number text-[hsl(var(--muted-foreground))]">{row.itemsCount}</td>
                      <td className="amb-number text-right font-bold text-[#293f5b]">{formatMinor(row.totalMinor)}</td>
                      <td className="text-[10px] text-[#586c82]">{row.paymentMethod ?? "—"}</td>
                      <td><StatusPill status={row.status} /></td>
                      <td><button className="text-slate-400 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); handleSelect(row.id); }}><MoreHorizontal size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {page.pageCount > 1 && (
             <div className="flex items-center justify-between px-4 py-3 border-t border-[hsl(var(--border))]">
               <div className="text-[11px] text-slate-500">Page {page.page} of {page.pageCount}</div>
               <div className="flex gap-2">
                 <button className="amb-control" disabled={page.page <= 1} onClick={() => setParam("page", String(page.page - 1))}>Previous</button>
                 <button className="amb-control" disabled={page.page >= page.pageCount} onClick={() => setParam("page", String(page.page + 1))}>Next</button>
               </div>
             </div>
          )}
        </div>

        {inspectorOpen && txDetail && (
          <>
            <div className="amb-drawer-backdrop md:hidden" onClick={() => setInspectorOpen(false)} />
            <aside className="amb-inspector slide-in flex h-full flex-col overflow-y-auto z-40">
              <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-4 py-3 shrink-0">
                <div>
                  <div className="text-[12px] font-bold text-[#2c435f]">Transaction Details</div>
                  <div className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">
                    ERP Sync: {txDetail.erpSyncStatus} {txDetail.erpInvoiceId ? \`(\${txDetail.erpInvoiceId})\` : ""}
                  </div>
                </div>
                <button className="amb-icon-btn -mr-1 -mt-1" onClick={() => setInspectorOpen(false)}><X size={16} /></button>
              </div>
              
              <div className="space-y-4 px-4 py-3 flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono text-[13px] font-bold text-[#263e5b]">{txDetail.billNumber}</div>
                    <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(txDetail.completedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
                    <div className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">Cashier: {txDetail.cashierName}</div>
                  </div>
                  <StatusPill status={txDetail.status} />
                </div>
                
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.45)] p-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e4f2ff] text-[hsl(var(--primary))]"><UserRound size={15} /></span>
                    <div>
                      <div className="text-[11px] font-bold text-[#334d68]">{txDetail.customer?.name || "Walk-in Customer"}</div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{txDetail.customer?.phone || "No phone provided"}</div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[.06em] text-[hsl(var(--muted-foreground))]">Order Items</div>
                  <div className="space-y-2.5">
                    {txDetail.items.map((item, idx) => (
                      <div className="flex gap-2.5" key={idx}>
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-[#edf0f3] bg-[#f8fafc]">
                           {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                           <div className="truncate text-[11px] font-bold text-[#293f5b]">{item.name}</div>
                           <div className="mt-0.5 text-[9px] text-[#5e7187]">SKU: {item.sku} {item.size ? \`| \${item.size}\` : ""} {item.colour ? \`| \${item.colour}\` : ""}</div>
                           <div className="mt-1 flex items-center justify-between text-[10px]"><span className="text-[hsl(var(--muted-foreground))]">{item.quantity} x {formatMinor(item.unitPriceMinor)}</span><b className="text-[#3b526c]">{formatMinor(item.lineTotalMinor)}</b></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-[hsl(var(--border))] bg-[#f8fafc] p-3 text-[10px]">
                  <div className="flex justify-between mb-1.5"><span className="text-[#5e7187]">Subtotal</span><span className="font-medium text-[#3b526c]">{formatMinor(txDetail.subtotalMinor)}</span></div>
                  {txDetail.discountMinor > 0 && <div className="flex justify-between mb-1.5 text-emerald-600"><span className="font-medium">Discount</span><span className="font-bold">-{formatMinor(txDetail.discountMinor)}</span></div>}
                  <div className="flex justify-between mb-2"><span className="text-[#5e7187]">Tax</span><span className="font-medium text-[#3b526c]">{formatMinor(txDetail.taxMinor)}</span></div>
                  <div className="flex justify-between border-t border-[hsl(var(--border))] pt-2 text-[12px]"><span className="font-bold text-[#263e5b]">Total</span><span className="font-bold text-[hsl(var(--primary))]">{formatMinor(txDetail.totalMinor)}</span></div>
                </div>

                <div className="rounded border border-[hsl(var(--border))] p-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[.06em] text-[hsl(var(--muted-foreground))]">Payment</div>
                  <div className="space-y-2">
                    {txDetail.payments.map((p, idx) => (
                      <div key={idx} className="flex flex-col">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1.5 text-[#445a72]"><CreditCard size={13} className="text-[hsl(var(--primary))]" />{p.method} {txDetail.payments.length > 1 ? \`(Split)\` : ""}</span>
                          <b className="text-[#293f5b]">{formatMinor(p.amountMinor)}</b>
                        </div>
                        {p.reference && <div className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">Ref: {p.reference}</div>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] pt-2 border-t border-[hsl(var(--border))] flex justify-between">
                    <span className="text-[hsl(var(--muted-foreground))]">Paid</span>
                    <b className="text-[#293f5b]">{formatMinor(txDetail.paidMinor)}</b>
                  </div>
                </div>

                <div className="flex gap-2 pb-4">
                  <button className="amb-control flex-1 justify-center text-[10px] font-bold text-[hsl(var(--primary))]" onClick={() => handleNotice("Print preview prepared.")}><ArrowDownToLine size={13} /> Print Bill</button>
                  <button className="amb-control flex-1 justify-center text-[10px] font-bold text-slate-400 cursor-not-allowed"><RefreshCcw size={13} /> Return</button>
                  <button className="amb-icon-btn border border-[hsl(var(--border))]" onClick={() => handleNotice("More actions available.")}><MoreHorizontal size={15} /></button>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      <section className="analytics-grid mt-3 grid grid-cols-[1.25fr_1fr_1fr] gap-3">
         {/* Trend Chart (simple bar) */}
         <div className="amb-card min-w-0 p-3 flex flex-col h-[220px]">
           <div><h3 className="text-[12px] font-bold text-[#2d4561]">Sales Trend</h3><div className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">Daily sales volume (IST)</div></div>
           <div className="flex-1 mt-4 flex items-end gap-2 px-2 pb-2">
             {analytics.trend.length === 0 ? <span className="text-[10px] text-slate-400 mx-auto">No data</span> : analytics.trend.map(t => {
               const max = Math.max(...analytics.trend.map((x) => x.amountMinor), 1);
               const pct = Math.max((t.amountMinor / max) * 100, 2);
               return (
                 <div key={t.label} className="flex-1 flex flex-col items-center justify-end h-full">
                   <div className="w-full max-w-[24px] bg-[hsl(var(--primary))] rounded-t-sm mx-auto" style={{ height: \`\${pct}%\` }} title={\`\${t.label}: \${formatMinor(t.amountMinor)}\`} />
                   <span className="text-[8px] text-[hsl(var(--muted-foreground))] mt-1 truncate">{t.label.split(" ")[0]}</span>
                 </div>
               )
             })}
           </div>
         </div>
         {/* Payment Mix */}
         <div className="amb-card min-w-0 p-3 h-[220px] overflow-hidden">
           <div><h3 className="text-[12px] font-bold text-[#2d4561]">Payment Mode</h3><div className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">How customers paid</div></div>
           <div className="mt-3 space-y-2">
             {analytics.paymentMix.length === 0 ? <span className="text-[10px] text-slate-400">No data</span> : analytics.paymentMix.map((p, i) => {
               const total = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0);
               const pct = ((p.amountMinor / total) * 100).toFixed(0);
               const colors = ["#2587df", "#8b5cda", "#f0ad44", "#36b78e"];
               return (
                 <div className="flex items-center gap-1.5 text-[10px]" key={p.method}>
                   <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
                   <span className="w-9 text-[#50657b] font-semibold">{p.method}</span>
                   <span className="ml-auto text-[hsl(var(--muted-foreground))]">{pct}%</span>
                   <b className="w-[59px] text-right text-[#3b526c] truncate">{formatMinor(p.amountMinor)}</b>
                 </div>
               )
             })}
           </div>
         </div>
         {/* Types */}
         <div className="amb-card min-w-0 p-3 h-[220px] overflow-hidden">
           <div><h3 className="text-[12px] font-bold text-[#2d4561]">Transaction Type</h3><div className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">Volume by transaction status</div></div>
           <div className="mt-4 space-y-3">
             {analytics.typeMix.map((t) => {
               const total = analytics.typeMix.reduce((a, b) => a + b.count, 0) || 1;
               const pct = (t.count / total) * 100;
               return (
                 <div key={t.status}>
                   <div className="mb-1 flex items-center justify-between text-[10px]">
                     <span className="text-[#50657b] font-semibold capitalize">{t.status.toLowerCase()}</span>
                     <span className="amb-number font-bold text-[#3b526c]">{t.count} <small className="ml-1 font-medium text-[hsl(var(--muted-foreground))]">{pct.toFixed(0)}%</small></span>
                   </div>
                   <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f3]">
                     <div className="h-full rounded-full" style={{ width: \`\${Math.max(pct, 2)}%\`, background: t.status === "COMPLETED" ? "#2587df" : "#a2adba" }} />
                   </div>
                 </div>
               )
             })}
             <div className="opacity-40">
               <div className="mb-1 flex items-center justify-between text-[10px]">
                 <span className="text-[#50657b] font-semibold">Returns</span>
                 <span className="amb-number font-bold text-[#3b526c]">0 <small className="ml-1 font-medium text-[hsl(var(--muted-foreground))]">N/A</small></span>
               </div>
               <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f3]" />
             </div>
           </div>
         </div>
      </section>

      {notice && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md bg-[#263e5b] px-4 py-2.5 text-[11px] font-semibold text-white shadow-lg rise-in" role="status">{notice}</div>}
    </>
  );
}
`;

fs.writeFileSync('apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx', code);
