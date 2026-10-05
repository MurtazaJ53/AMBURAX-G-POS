"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, ChevronRight, Edit2 } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime, formatDateOnly } from "../sales/formatDateTime";
import { type CustomerDetail } from "@/server/sales/customers";
import { buttonClass } from "../_components/ui";

type Tab = "HISTORY" | "DUE" | "NOTES";

export function CustomerDetailPanel({ detail }: { detail: CustomerDetail }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("HISTORY");
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save previous focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    if (panelRef.current) {
      panelRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.push("/customers");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Attempt to restore focus on unmount
      if (previousFocusRef.current && document.body.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      } else {
        const fallback = document.getElementById("customer-toolbar-title");
        if (fallback) {
          fallback.setAttribute("tabindex", "-1");
          fallback.focus();
        }
      }
    };
  }, [router]);

  const handleClose = () => {
    router.push("/customers");
  };

  const initial = detail.name.slice(0, 2).toUpperCase();
  const avgOrderValue = detail.purchaseCount > 0 ? Math.round(detail.totalSpentMinor / detail.purchaseCount) : null;

  return (
    <>
      {/* Mobile/Tablet Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity xl:hidden"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div 
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-dialog-title"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[360px] xl:relative xl:w-auto xl:inset-auto xl:z-auto bg-white xl:rounded-xl xl:border xl:border-slate-200 shadow-2xl xl:shadow-sm flex flex-col focus:outline-none transition-transform duration-200"
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-4 shrink-0">
          <h2 id="customer-dialog-title" className="text-sm font-bold text-slate-900">Customer Details</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Edit is currently unavailable"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-600 cursor-not-allowed opacity-50"
            >
              <Edit2 className="h-4 w-4" />
              <span className="sr-only">Edit</span>
            </button>
            <button 
              onClick={handleClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Identity Header */}
          <div className="p-4">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col items-start gap-1">
                  <b className="truncate text-sm text-slate-900 leading-tight">{detail.name}</b>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 capitalize">
                    {detail.customerType.toLowerCase()}
                  </span>
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                  <p>Phone: <span className="text-slate-700">{detail.phone || "—"}</span></p>
                  <p>Email: <span className="text-slate-700">{detail.email || "—"}</span></p>
                  <p>Since: <span className="text-slate-700">{formatDateOnly(detail.createdAt)}</span></p>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/50">
            <div className="border-r border-slate-100 p-3 flex flex-col items-center text-center justify-center">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Lifetime Spend</span>
              <b className="text-[13px] text-slate-900">{formatMinor(detail.totalSpentMinor)}</b>
            </div>
            <div className="border-r border-slate-100 p-3 flex flex-col items-center text-center justify-center">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Last Purchase</span>
              <b className="text-[13px] text-slate-900">{detail.lastPurchaseAt ? formatDateOnly(detail.lastPurchaseAt) : "Never"}</b>
            </div>
            <div className="p-3 flex flex-col items-center text-center justify-center">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Avg Order Val</span>
              <b className="text-[13px] text-slate-900">{avgOrderValue !== null ? formatMinor(avgOrderValue) : "—"}</b>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 px-4 mt-2">
            {(["HISTORY", "DUE", "NOTES"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 pt-3 px-3 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                }`}
              >
                {tab === "HISTORY" ? "Sales History" : tab === "DUE" ? "Due Summary" : "Notes"}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-0">
            {activeTab === "HISTORY" && (
              <div className="divide-y divide-slate-100">
                {detail.recentSales.length > 0 ? (
                  detail.recentSales.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-900">
                          {sale.completedAt ? formatDateTime(sale.completedAt) : "Pending"}
                        </span>
                        <span className="text-[10px] uppercase text-slate-500 tracking-wider">
                          {sale.status}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-slate-900">
                        {formatMinor(sale.totalMinor)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-sm text-slate-500">
                    No sales history found.
                  </div>
                )}
              </div>
            )}

            {activeTab === "DUE" && (
              <div className="p-6">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
                  <h4 className="text-xs font-semibold text-slate-900 mb-1">ERP receivables not connected</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Khata and outstanding balance information will appear here when ERP receivables are connected.
                  </p>
                </div>
              </div>
            )}

            {activeTab === "NOTES" && (
              <div className="p-6 text-center">
                <p className="text-sm text-slate-500">Customer notes are not configured.</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 p-4 bg-white shrink-0">
          <Link 
            href={`/customers/${detail.id}`} 
            className={`${buttonClass("primary")} w-full justify-center`}
          >
            View Full Profile
          </Link>
        </div>
      </div>
    </>
  );
}
