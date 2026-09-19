import Link from "next/link";
import { X, CalendarDays, ChevronRight } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../sales/formatDateTime";
import { type CustomerDetail } from "@/server/sales/customers";
import { Card, buttonClass } from "../_components/ui";

export function CustomerDetailPanel({ detail }: { detail: CustomerDetail }) {
  const initial = detail.name.slice(0, 2).toUpperCase();
  const isOverdue = detail.paymentTermsDays !== null; // Just for UI indication

  return (
    <Card className="overflow-hidden flex flex-col h-full bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <h2 className="text-sm font-bold text-slate-900">Customer Details</h2>
        <Link href="/customers" className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </Link>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600 ring-2 ring-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="truncate text-slate-900">{detail.name}</b>
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 uppercase">
                {detail.customerType}
              </span>
            </div>
            <div className="mt-1 space-y-1 text-xs text-slate-500">
              <p>Phone: {detail.phone || "—"}</p>
              <p>Email: {detail.email || "—"}</p>
              <p>GSTIN: {detail.gstin || "—"}</p>
              <p>Since: {formatDateTime(detail.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/50">
        <div className="border-r border-slate-100 p-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">Purchases</span>
          <b className="text-sm text-slate-900">{detail.purchaseCount}</b>
        </div>
        <div className="border-r border-slate-100 p-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">Lifetime Spend</span>
          <b className="text-sm text-slate-900">{formatMinor(detail.totalSpentMinor)}</b>
        </div>
        <div className="p-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">Addresses</span>
          <b className="text-sm text-slate-900">{detail.addressCount}</b>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div>
          <h3 className="text-xs font-semibold text-slate-900 mb-2">Commercial Profile</h3>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {detail.creditLimitMinor !== null || detail.paymentTermsDays !== null || detail.priceListId !== null ? (
              <ul className="space-y-1">
                {detail.creditLimitMinor !== null && <li>Credit Limit: {formatMinor(detail.creditLimitMinor)}</li>}
                {detail.paymentTermsDays !== null && <li>Payment Terms: {detail.paymentTermsDays} days</li>}
                {detail.priceListId !== null && <li>Price List: {detail.priceListId}</li>}
              </ul>
            ) : (
              <p>No special commercial terms agreed.</p>
            )}
          </div>
        </div>
        
        <div>
          <h3 className="text-xs font-semibold text-slate-900 mb-2">Khata & Dues</h3>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-700">
            <p className="font-semibold mb-1">ERP receivables data not connected</p>
            <p className="opacity-90">Outstanding balances, khata ledgers, and payment history are managed in ERPNext and are currently unavailable.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
