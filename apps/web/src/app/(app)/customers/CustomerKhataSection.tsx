"use client";

import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, Clock, AlertCircle, Loader2, IndianRupee, ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateOnly } from "../sales/formatDateTime";
import { NotConnectedChip } from "./customerUi";

export interface OutstandingInvoice {
  name: string;
  customer: string;
  outstandingAmount: number;
  grandTotal: number;
  postingDate: string;
  dueDate: string;
  status: string;
  daysPending: number;
}

export interface CustomerDueSummary {
  customerId: string;
  customerName: string;
  phone: string | null;
  erpCustomerName: string | null;
  totalDueMinor: number;
  overdueMinor: number;
  daysPending: number;
  invoicesCount: number;
  invoices: OutstandingInvoice[];
}

export function CustomerKhataSection({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerDueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchKhata() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/khata/customers/${encodeURIComponent(customerId)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Receivables request failed with status ${res.status}`);
        }
        const json = await res.json();
        if (active) {
          setData(json.receivables ?? null);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : "Accounting sync temporarily unavailable.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    fetchKhata();

    return () => {
      active = false;
    };
  }, [customerId]);

  return (
    <section
      aria-labelledby="profile-khata-heading"
      className="cust-rise relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      style={{ ["--i" as string]: 10 }}
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="profile-khata-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
              <BookOpen className="h-4 w-4" />
            </span>
            Khata &amp; dues
          </h2>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
              <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
              Checking sync...
            </span>
          ) : error ? (
            <NotConnectedChip label="Sync unavailable" />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Accounting Connected
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-xs text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Fetching live receivables from accounting...</span>
          </div>
        ) : error ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-900">Accounting sync unavailable</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  {error} Outstanding balances are held authoritative in accounting and will resume once reachable.
                </p>
              </div>
            </div>
          </div>
        ) : data ? (
          <div className="mt-4 space-y-4">
            {/* Balance Overview Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <span className="text-[11px] font-medium text-slate-500">Total Outstanding</span>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                  {formatMinor(data.totalDueMinor)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <span className="text-[11px] font-medium text-slate-500">Overdue Amount</span>
                <p className={`mt-1 text-lg font-bold tabular-nums ${data.overdueMinor > 0 ? "text-rose-600" : "text-slate-900"}`}>
                  {formatMinor(data.overdueMinor)}
                </p>
              </div>
            </div>

            {/* Pending Invoices / Ageing Status */}
            <div className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">Days Pending</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {data.daysPending > 0 ? `${data.daysPending} days` : "Current"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">Pending Invoices</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {data.invoicesCount} {data.invoicesCount === 1 ? "invoice" : "invoices"}
                </span>
              </div>
            </div>

            {/* Invoice Breakdown List if any */}
            {data.invoices.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Receivable Invoices ({data.invoices.length})
                </p>
                <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {data.invoices.map((inv) => (
                    <div key={inv.name} className="flex items-center justify-between p-2.5 text-xs hover:bg-slate-50">
                      <div className="min-w-0 pr-2">
                        <p className="font-mono font-medium text-blue-700">{inv.name}</p>
                        <p className="text-[11px] text-slate-500">
                          Due {inv.dueDate ? formatDateOnly(new Date(inv.dueDate)) : "—"} · {inv.daysPending}d pending
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums text-slate-900">
                          ₹{inv.outstandingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </p>
                        <span className={`inline-block text-[10px] font-medium ${
                          inv.status === "Overdue" ? "text-rose-600" : "text-amber-600"
                        }`}>
                          {inv.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" />
                <p className="mt-1.5 text-xs font-medium text-slate-800">All invoices cleared</p>
                <p className="text-[11px] text-slate-500">No outstanding customer dues recorded in accounting.</p>
              </div>
            )}

            <div className="pt-1">
              <Link
                href="/khata"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                Open Full Khata Ledger <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
