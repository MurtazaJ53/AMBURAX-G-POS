"use client";

import { useState } from "react";
import { Printer, Download, X, BookOpen, Calendar, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

export interface StatementInvoice {
  name: string;
  postingDate: string;
  dueDate: string;
  grandTotal: number;
  outstandingAmount: number;
  status: string;
}

export function CustomerStatementModal(props: {
  isOpen: boolean;
  onClose: () => void;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    customerType?: string;
  };
  khataData?: {
    totalDueMinor: number;
    overdueMinor: number;
    invoices: StatementInvoice[];
  } | null;
  storeName?: string;
}) {
  if (!props.isOpen) return null;

  const invoices = props.khataData?.invoices ?? [];
  const totalOutstanding = props.khataData?.totalDueMinor ?? 0;
  const overdueAmount = props.khataData?.overdueMinor ?? 0;

  function handlePrint() {
    window.print();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header - Screen only */}
        <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Customer Account Statement</h3>
              <p className="text-xs text-slate-500">Statement of credit dues, invoices, and payment status.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-indigo-700"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Statement</span>
            </button>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Statement Document View */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 print:bg-white print:p-0">
          <div
            id="customer-statement-doc"
            className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:max-w-none print:border-none print:p-0 print:shadow-none"
          >
            {/* Store & Customer Header */}
            <div className="flex items-start justify-between border-b border-slate-200 pb-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                  {props.storeName || "RETAIL STORE"}
                </span>
                <h1 className="mt-1 text-xl font-black text-slate-900">STATEMENT OF ACCOUNT</h1>
                <p className="text-xs text-slate-500">
                  Generated: {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-slate-500">Account For</span>
                <p className="text-base font-bold text-slate-900">{props.customer.name}</p>
                {props.customer.phone && <p className="text-xs text-slate-600">Ph: {props.customer.phone}</p>}
                {props.customer.email && <p className="text-xs text-slate-600">{props.customer.email}</p>}
              </div>
            </div>

            {/* Dues Summary Cards */}
            <div className="my-5 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-xs font-medium text-slate-500">Total Outstanding Balance</span>
                <div className="mt-1 font-mono text-xl font-bold text-slate-900">
                  {formatMinor(totalOutstanding)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-xs font-medium text-slate-500">Overdue Balance</span>
                <div className={`mt-1 font-mono text-xl font-bold ${overdueAmount > 0 ? "text-rose-600" : "text-slate-900"}`}>
                  {formatMinor(overdueAmount)}
                </div>
              </div>
            </div>

            {/* Invoices Ledger Table */}
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-100/70 font-bold text-slate-700">
                  <tr>
                    <th className="px-3 py-2.5">Invoice #</th>
                    <th className="px-3 py-2.5">Posting Date</th>
                    <th className="px-3 py-2.5">Due Date</th>
                    <th className="px-3 py-2.5 text-right">Bill Total</th>
                    <th className="px-3 py-2.5 text-right">Balance Due</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {invoices.length > 0 ? (
                    invoices.map((inv) => (
                      <tr key={inv.name} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 font-mono font-medium text-indigo-700">{inv.name}</td>
                        <td className="px-3 py-2 text-slate-600">{inv.postingDate || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{inv.dueDate || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-900">
                          ₹{inv.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          ₹{inv.outstandingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              inv.status === "Overdue"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                        No pending invoices on this account.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Note & Statutory terms */}
            <div className="mt-6 border-t border-slate-200 pt-4 text-[10px] text-slate-400">
              <p>
                * Dues are synchronized with the accounting ledgers. Please quote your customer name and invoice number when settling by UPI or bank transfer.
              </p>
            </div>
          </div>
        </div>

        {/* Footer actions - Screen only */}
        <div className="flex items-center justify-end border-t border-slate-100 p-3 print:hidden">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
