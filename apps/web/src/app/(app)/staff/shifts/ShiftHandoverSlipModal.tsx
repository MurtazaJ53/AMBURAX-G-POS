"use client";

import { useRef } from "react";
import { X, Printer, ShieldCheck, UserCheck, Calendar, Clock, ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatTime } from "@/app/(app)/sales/formatDateTime";

export interface ShiftHandoverSlipProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    id: string;
    openedAt: Date | string;
    closedAt: Date | string | null;
    cashierName: string;
    posDeviceName: string;
    posDeviceCode: string;
    openingFloatMinor: number | null;
    billsCount: number;
    expectedCashMinor: number;
    expectedUpiMinor: number;
    expectedCardMinor: number;
    paidInMinor?: number;
    paidOutMinor?: number;
    counts?: Array<{
      method: string;
      expectedMinor: number;
      countedMinor: number;
      differenceMinor: number;
    }>;
    closingNote?: string | null;
    varianceStatus?: string | null;
  };
}

export function ShiftHandoverSlipModal({ isOpen, onClose, session }: ShiftHandoverSlipProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const openedDate = new Date(session.openedAt);
  const closedDate = session.closedAt ? new Date(session.closedAt) : null;

  const totalExpectedMinor =
    session.expectedCashMinor + session.expectedUpiMinor + session.expectedCardMinor;

  const totalCountedMinor = (session.counts ?? []).reduce(
    (sum, c) => sum + c.countedMinor,
    0
  );

  const totalDifferenceMinor = (session.counts ?? []).reduce(
    (sum, c) => sum + c.differenceMinor,
    0
  );

  function handlePrint() {
    window.print();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-handover-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h3 id="shift-handover-title" className="text-base font-bold text-slate-900">
              Till Shift Handover &amp; Settlement Slip
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Printable Paper Area */}
        <div
          ref={printRef}
          className="my-4 max-h-[65vh] overflow-y-auto rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 font-sans print:border-none print:bg-white print:p-0"
        >
          {/* Header */}
          <div className="text-center pb-3 border-b border-slate-200">
            <h4 className="text-sm font-black uppercase tracking-wider text-slate-900">
              Shift Settlement &amp; Handover
            </h4>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              Device: <span className="font-semibold text-slate-800">{session.posDeviceName} ({session.posDeviceCode})</span>
            </p>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">Session ID: {session.id}</p>
          </div>

          {/* Shift Details */}
          <div className="grid grid-cols-2 gap-3 py-3 border-b border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Primary Cashier</span>
              <span className="font-bold text-slate-900 flex items-center gap-1 mt-0.5">
                <UserCheck className="h-3.5 w-3.5 text-indigo-600" />
                {session.cashierName}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Shift Timing</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {formatTime(openedDate)} – {closedDate ? formatTime(closedDate) : "Active"}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Bills Rang Up</span>
              <span className="font-bold text-slate-900 font-mono">{session.billsCount} receipts</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Opening Float</span>
              <span className="font-bold text-slate-900 font-mono">
                {session.openingFloatMinor !== null ? formatMinor(session.openingFloatMinor) : "₹0.00"}
              </span>
            </div>
          </div>

          {/* Cash In/Out Summary if recorded */}
          {(session.paidInMinor || session.paidOutMinor) ? (
            <div className="py-2.5 border-b border-slate-200 text-xs flex justify-between">
              <span className="text-slate-600 flex items-center gap-1">
                <ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" /> Pay-In: {formatMinor(session.paidInMinor ?? 0)}
              </span>
              <span className="text-slate-600 flex items-center gap-1">
                <ArrowUpRight className="h-3.5 w-3.5 text-rose-600" /> Pay-Out: {formatMinor(session.paidOutMinor ?? 0)}
              </span>
            </div>
          ) : null}

          {/* Expected vs Counted Breakdown */}
          <div className="py-3 border-b border-slate-200">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
              Tender Reconciliation
            </span>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                  <th className="text-left pb-1 font-semibold">Tender</th>
                  <th className="text-right pb-1 font-semibold">Expected</th>
                  <th className="text-right pb-1 font-semibold">Physical Count</th>
                  <th className="text-right pb-1 font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {session.counts && session.counts.length > 0 ? (
                  session.counts.map((c) => (
                    <tr key={c.method} className="py-1">
                      <td className="py-1.5 text-slate-800 font-sans font-semibold">{c.method}</td>
                      <td className="py-1.5 text-right text-slate-600">{formatMinor(c.expectedMinor)}</td>
                      <td className="py-1.5 text-right font-bold text-slate-900">{formatMinor(c.countedMinor)}</td>
                      <td
                        className={`py-1.5 text-right font-bold ${
                          c.differenceMinor === 0
                            ? "text-slate-400"
                            : c.differenceMinor > 0
                            ? "text-emerald-700"
                            : "text-rose-700"
                        }`}
                      >
                        {c.differenceMinor === 0
                          ? "₹0"
                          : c.differenceMinor > 0
                          ? `+${formatMinor(c.differenceMinor)}`
                          : formatMinor(c.differenceMinor)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <>
                    <tr className="py-1">
                      <td className="py-1.5 text-slate-800 font-sans font-semibold">CASH</td>
                      <td className="py-1.5 text-right text-slate-600">{formatMinor(session.expectedCashMinor)}</td>
                      <td className="py-1.5 text-right text-slate-400 italic font-sans text-[11px]">Uncounted</td>
                      <td className="py-1.5 text-right text-slate-400">—</td>
                    </tr>
                    <tr className="py-1">
                      <td className="py-1.5 text-slate-800 font-sans font-semibold">UPI</td>
                      <td className="py-1.5 text-right text-slate-600">{formatMinor(session.expectedUpiMinor)}</td>
                      <td className="py-1.5 text-right text-slate-400 italic font-sans text-[11px]">Uncounted</td>
                      <td className="py-1.5 text-right text-slate-400">—</td>
                    </tr>
                    <tr className="py-1">
                      <td className="py-1.5 text-slate-800 font-sans font-semibold">CARD</td>
                      <td className="py-1.5 text-right text-slate-600">{formatMinor(session.expectedCardMinor)}</td>
                      <td className="py-1.5 text-right text-slate-400 italic font-sans text-[11px]">Uncounted</td>
                      <td className="py-1.5 text-right text-slate-400">—</td>
                    </tr>
                  </>
                )}
              </tbody>
              {session.counts && session.counts.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-mono font-bold text-slate-900 text-xs">
                    <td className="pt-2 text-slate-900 font-sans">Total</td>
                    <td className="pt-2 text-right">{formatMinor(totalExpectedMinor)}</td>
                    <td className="pt-2 text-right text-indigo-900">{formatMinor(totalCountedMinor)}</td>
                    <td
                      className={`pt-2 text-right ${
                        totalDifferenceMinor === 0
                          ? "text-slate-400"
                          : totalDifferenceMinor > 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}
                    >
                      {totalDifferenceMinor === 0
                        ? "₹0"
                        : totalDifferenceMinor > 0
                        ? `+${formatMinor(totalDifferenceMinor)}`
                        : formatMinor(totalDifferenceMinor)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Notes / Variance Explanation */}
          {session.closingNote && (
            <div className="py-3 border-b border-slate-200 text-xs">
              <span className="text-[11px] font-bold text-slate-700 block">Cashier Closing Note:</span>
              <p className="mt-1 text-slate-600 italic bg-white p-2 rounded border border-slate-200">
                &ldquo;{session.closingNote}&rdquo;
              </p>
            </div>
          )}

          {/* Signature / Handover Acknowledgment */}
          <div className="mt-6 pt-4 border-t border-dashed border-slate-300 grid grid-cols-2 gap-8 text-center text-xs">
            <div className="flex flex-col items-center">
              <div className="h-10 w-full border-b border-slate-400 mb-1" />
              <span className="font-semibold text-slate-800">Outgoing Cashier Sign</span>
              <span className="text-[10px] text-slate-400">Handed over physical register</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="h-10 w-full border-b border-slate-400 mb-1" />
              <span className="font-semibold text-slate-800">Store Manager Sign</span>
              <span className="text-[10px] text-slate-400">Verified counts &amp; sealed safe</span>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">Statutory drawer record for daily register audit</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Slip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
