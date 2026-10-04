import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { 
  ChevronRight, 
  ArrowDownToLine, 
  Share2, 
  RefreshCcw, 
  MoreHorizontal, 
  Printer, 
  Mail, 
  MessageCircle, 
  XCircle, 
  Pencil,
  Copy,
  ReceiptText
} from "lucide-react";

import { CopyButton } from "./CopyButton";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../formatDateTime";
import { PrintButton } from "./PrintButton";

function StatusPill({ status, tone = "default" }: { status: string, tone?: "success" | "danger" | "warning" | "default" }) {
  if (tone === "success" || status === "COMPLETED" || status === "Success" || status === "CONFIRMED" || status === "SUCCESS") 
    return <span className="amb-pill bg-emerald-100 text-emerald-700">{status}</span>;
  if (tone === "danger" || status === "VOIDED" || status === "FAILED") 
    return <span className="amb-pill bg-red-100 text-red-700">{status}</span>;
  if (tone === "warning" || status === "PENDING") 
    return <span className="amb-pill bg-amber-100 text-amber-700">{status}</span>;
  
  return <span className="amb-pill bg-slate-100 text-slate-600">{status}</span>;
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const resolvedParams = await params;
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  // `/auth/login` is the real sign-in route; `/login` does not exist and 404s, which is what
  // a logged-out visitor following a bookmarked bill link used to hit. Same guards as before —
  // only the destination changes.
  if (!token) return redirect("/auth/login");

  const ctx = await resolvePosContext(token);
  if (ctx.status !== "ok") return redirect("/auth/login");

  const sale = await getSaleDetail({ tenantId: ctx.context.tenantId, saleId: resolvedParams.id });
  if (!sale) notFound();

  const isPosted = sale.erpSyncStatus === "SYNCED" || sale.erpSyncStatus === "POSTED" || sale.erpSyncStatus === "SUCCESS";
  const erpStatusText = isPosted ? "Submitted" : (sale.erpSyncStatus === "FAILED" ? "Failed" : "Pending");

  // `w-full min-w-0` on the page container is what the rest of the app already uses (see the
  // inventory forms). Without it this box sized to its content rather than to the track left
  // beside the shell sidebar, so it ran ~184px past a 1280 viewport and ~424px past a 390 one.
  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 lg:p-8 text-[11px] text-slate-900">
      
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <Link href="/sales" className="hover:text-blue-600 transition-colors">Sales & Transactions</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="font-semibold text-slate-900">Bill Details</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Bill Details</h1>
          <p className="text-slate-500 text-[11px]">View complete transaction details, items, payments and history</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton />
        </div>
      </div>

      {/* Bill Overview Banner */}
      <div className="amb-card p-5 mb-5 flex flex-wrap lg:flex-nowrap items-center gap-x-8 gap-y-4">
        <div className="flex flex-col items-center justify-center pr-8 lg:border-r border-slate-200 min-w-[120px]">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${sale.status === "COMPLETED" ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
            <ReceiptText className="w-5 h-5" />
          </div>
          <StatusPill status={sale.status === "COMPLETED" ? "Completed" : "Voided"} tone={sale.status === "COMPLETED" ? "success" : "danger"} />
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="amb-label mb-1">Bill No.</div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{sale.billNumber}</span>
              <CopyButton text={sale.billNumber} title="Copy Bill Number" />
            </div>
            <div className="text-slate-500 mt-0.5">{formatDateTime(sale.completedAt)}</div>
          </div>
          
          <div>
            <div className="amb-label mb-1">POS Invoice</div>
            <div className="flex items-center gap-2">
              {isPosted && sale.erpInvoiceId ? (
                <>
                  <span className="text-sm font-medium text-blue-600">{sale.erpInvoiceId}</span>
                  <CopyButton text={sale.erpInvoiceId} title="Copy POS Invoice" />
                </>
              ) : (
                <span className="text-sm text-amber-600">Pending Sync</span>
              )}
            </div>
          </div>
          
          <div>
            <div className="amb-label mb-1">Order Type</div>
            <span className="text-sm font-medium">Walk-in</span>
          </div>
          
          <div>
            <div className="amb-label mb-1">Cashier</div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                {sale.cashierName.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{sale.cashierName}</span>
                <span className="text-[10px] text-slate-500">Cashier</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Main Left Column */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          
          {/* Items Table */}
          <div className="amb-card overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="font-bold text-sm">Items ({sale.items.length})</h3>
            </div>
            <div className="amb-table-wrap">
              <table className="amb-table w-full">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Variant</th>
                    <th className="text-right">Qty</th>
                    {/* These read `(?)` before — a rupee sign that did not survive an encoding
                        step. Every cell below renders formatMinor, which is INR. */}
                    <th className="text-right">Price (₹)</th>
                    <th className="text-right">Discount (₹)</th>
                    <th className="text-right">Tax (₹)</th>
                    <th className="text-right">Total (₹)</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sale.items.map((item, idx) => {
                    const variantText = [item.size, item.colour].filter(Boolean).join(" / ");
                    return (
                      <tr key={item.id}>
                        <td className="amb-number text-slate-500">{idx + 1}</td>
                        <td className="font-medium whitespace-normal line-clamp-2" title={item.name}>{item.name}</td>
                        <td className="text-slate-500">{item.sku}</td>
                        <td className="text-slate-500">{variantText || "-"}</td>
                        <td className="amb-number text-right">{item.quantity}</td>
                        <td className="amb-number text-right">{formatMinor(item.unitPriceMinor)}</td>
                        <td className="amb-number text-right">{formatMinor(item.lineDiscountMinor)}</td>
                        <td className="amb-number text-right">{formatMinor(item.taxMinor)}</td>
                        <td className="amb-number text-right font-bold">{formatMinor(item.lineTotalMinor)}</td>
                        <td className="text-center text-slate-400">
                          <MoreHorizontal className="w-4 h-4 mx-auto" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Information */}
          <div className="amb-card overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="font-bold text-sm">Payment Information</h3>
            </div>
            <div className="amb-table-wrap">
              <table className="amb-table w-full">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Date & Time</th>
                    <th>Method</th>
                    <th>Reference No.</th>
                    <th className="text-right">Amount (₹)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sale.payments.map((payment, idx) => (
                    <tr key={idx}>
                      <td className="amb-number text-slate-500">{idx + 1}</td>
                      <td className="text-slate-500">
                        {payment.confirmedAt ? formatDateTime(payment.confirmedAt) : "-"}
                      </td>
                      <td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
                          {payment.method}
                        </span>
                      </td>
                      <td className="text-slate-500">{payment.reference || "-"}</td>
                      <td className="amb-number text-right font-bold">{formatMinor(payment.amountMinor)}</td>
                      <td>
                        <StatusPill status={payment.status === "CONFIRMED" ? "Success" : payment.status} tone={payment.status === "CONFIRMED" ? "success" : "warning"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="amb-card p-4">
            <div className="amb-label mb-3 text-sm">Actions</div>
            <div className="flex flex-wrap gap-3">
              <PrintButton />
            </div>
          </div>
        </div>

        {/* Main Right Column */}
        <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 flex flex-col gap-5">
          
          {/* Customer */}
          <div className="amb-card p-4 relative">
            <button className="absolute top-4 right-4 amb-control h-7 px-2 text-[10px] opacity-50 cursor-not-allowed" disabled title="Future Feature">
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </button>
            <h3 className="font-bold text-sm mb-4">Customer</h3>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg font-bold">
                {sale.customer ? sale.customer.name.substring(0, 2).toUpperCase() : "WA"}
              </div>
              <div>
                <div className="font-bold text-sm">{sale.customer ? sale.customer.name : "Walk-in"}</div>
                <div className="text-slate-500 mb-1">{sale.customer?.phone || "-"}</div>
                {sale.customer && <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-bold rounded uppercase">VIP Customer</span>}
              </div>
            </div>
            
            {sale.customer && (
              <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 mt-2">
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Total Purchases</div>
                  <div className="font-bold">{"-"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Total Orders</div>
                  <div className="font-bold">{"-"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Outstanding</div>
                  <div className="font-bold text-blue-600 flex items-center">
                    {"-"} <ChevronRight className="w-3 h-3 ml-1" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Store & Session */}
          <div className="amb-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm">Store & Session</h3>
              <button className="amb-control h-7 px-2 text-[10px] opacity-50 cursor-not-allowed" disabled title="Future Feature">
                View Session
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-500">Store</span>
                <span className="font-medium text-right">{sale.storeName} ({sale.storeCode})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">POS Terminal</span>
                <span className="font-medium text-right">{sale.posTerminal || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Shift</span>
                <span className="font-medium text-right">{sale.posShiftStart ? formatDateTime(sale.posShiftStart) : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cashier</span>
                <span className="font-medium text-right">{sale.cashierName}</span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="amb-card p-4">
            <h3 className="font-bold text-sm mb-4">Summary</h3>
            <div className="space-y-2.5 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-500">Items Total</span>
                <span className="amb-number">{formatMinor(sale.subtotalMinor + sale.discountMinor)}</span>
              </div>
              {sale.discountMinor > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount</span>
                  <span className="amb-number">&minus;{formatMinor(sale.discountMinor)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="amb-number">{formatMinor(sale.subtotalMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">GST (Included)</span>
                <span className="amb-number">{formatMinor(sale.taxMinor)}</span>
              </div>
            </div>
            
            <div className="flex justify-between items-center py-3 border-y border-slate-100 mb-3">
              <span className="font-bold text-sm">Grand Total</span>
              <span className="amb-number font-bold text-base">{formatMinor(sale.totalMinor)}</span>
            </div>
            
            <div className="bg-emerald-50 rounded-md p-3 space-y-2 text-emerald-800">
              <div className="flex justify-between items-center">
                <span>Amount Paid</span>
                <span className="amb-number font-medium">{formatMinor(sale.paidMinor)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span>Balance Due</span>
                <span className="amb-number font-medium">{formatMinor(sale.totalMinor - sale.paidMinor)}</span>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div className="amb-card p-4 relative">
            <button className="absolute top-4 right-4 amb-control h-7 px-2 text-[10px] opacity-50 cursor-not-allowed" disabled title="Future Feature">
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </button>
            <h3 className="font-bold text-sm mb-4">Additional Information</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="text-slate-500">Payment Status</span>
                <div>
                  <StatusPill status={sale.paidMinor >= sale.totalMinor ? "Paid" : "Partial"} tone={sale.paidMinor >= sale.totalMinor ? "success" : "warning"} />
                </div>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="text-slate-500">Invoice Status</span>
                <div>
                  <StatusPill status={erpStatusText} tone={isPosted ? "success" : (sale.erpSyncStatus === "FAILED" ? "danger" : "warning")} />
                </div>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="text-slate-500">Created On</span>
                <span className="font-medium text-slate-900">{formatDateTime(sale.createdAt)}</span>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="text-slate-500">ERPNext Invoice</span>
                <span className="font-medium text-blue-600 flex items-center">
                  {sale.erpInvoiceId || "-"}
                  {sale.erpInvoiceId && <Copy className="w-3 h-3 ml-1.5 text-slate-400 cursor-pointer" />}
                </span>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="text-slate-500">Remarks</span>
                <span className="font-medium text-slate-900">-</span>
              </div>
            </div>
          </div>
          
          {/* Activity Timeline */}
          <div className="amb-card p-4">
            <h3 className="font-bold text-sm mb-4">Activity Timeline</h3>
            <div className="relative border-l border-slate-200 ml-2 space-y-4 pb-1">
              
              <div className="relative pl-4">
                <div className="absolute w-3 h-3 bg-emerald-500 rounded-full -left-[6.5px] top-1 border-2 border-white"></div>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-slate-900 leading-none mb-1">Bill Created</div>
                    <div className="text-[10px] text-slate-500">{formatDateTime(sale.createdAt)}</div>
                  </div>
                  <div className="text-[10px] text-slate-500">{sale.cashierName}</div>
                </div>
              </div>

              {sale.payments.map((p, idx) => (
                <div key={idx} className="relative pl-4">
                  <div className="absolute w-3 h-3 bg-blue-500 rounded-full -left-[6.5px] top-1 border-2 border-white"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-slate-900 leading-none mb-1">Payment Received ({p.method})</div>
                      <div className="text-[10px] text-slate-500">{p.confirmedAt ? formatDateTime(p.confirmedAt) : "-"}</div>
                    </div>
                    <div className="font-bold text-slate-900 amb-number text-right">
                      {formatMinor(p.amountMinor)}
                      <div className="text-[10px] font-normal text-slate-500 mt-0.5">{sale.cashierName}</div>
                    </div>
                  </div>
                </div>
              ))}
              
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
