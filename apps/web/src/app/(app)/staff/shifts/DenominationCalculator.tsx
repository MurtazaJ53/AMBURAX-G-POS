"use client";

import { useState } from "react";
import { Calculator, X, RotateCcw, Check } from "lucide-react";

export interface DenominationBreakdown {
  [note: number]: number; // note value (e.g. 500) -> count
}

const DENOMINATIONS = [
  { val: 500, label: "₹500 Notes" },
  { val: 200, label: "₹200 Notes" },
  { val: 100, label: "₹100 Notes" },
  { val: 50, label: "₹50 Notes" },
  { val: 20, label: "₹20 Notes" },
  { val: 10, label: "₹10 Notes / Coins" },
  { val: 5, label: "₹5 Coins" },
  { val: 2, label: "₹2 Coins" },
  { val: 1, label: "₹1 Coins" },
];

export function DenominationCalculator(props: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (totalRupees: number) => void;
  initialTotal?: number;
}) {
  const [counts, setCounts] = useState<{ [val: number]: string }>({});

  if (!props.isOpen) return null;

  const total = DENOMINATIONS.reduce((sum, d) => {
    const qty = parseInt(counts[d.val] || "0", 10);
    return sum + (isNaN(qty) ? 0 : qty * d.val);
  }, 0);

  function handleCountChange(val: number, str: string) {
    if (str === "" || /^\d+$/.test(str)) {
      setCounts((prev) => ({ ...prev, [val]: str }));
    }
  }

  function handleReset() {
    setCounts({});
  }

  function handleApply() {
    props.onApply(total);
    props.onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">Cash Denomination Calculator</h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Enter count of notes and coins in physical drawer. Total will be auto-calculated.
        </p>

        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {DENOMINATIONS.map((d) => {
            const count = parseInt(counts[d.val] || "0", 10) || 0;
            const subtotal = count * d.val;
            return (
              <div
                key={d.val}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5"
              >
                <div className="min-w-28 text-xs font-semibold text-slate-700">{d.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">&times;</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={counts[d.val] || ""}
                    onChange={(e) => handleCountChange(d.val, e.target.value)}
                    className="h-8 w-16 rounded-md border border-slate-200 bg-white text-center text-xs font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="min-w-16 text-right text-xs font-mono font-semibold text-slate-900">
                    ₹{subtotal.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Total Summary */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/80 p-3">
          <div>
            <span className="text-[11px] font-medium text-indigo-700 uppercase">Total Counted Cash</span>
            <div className="font-mono text-lg font-bold text-indigo-950">
              ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-indigo-100/60"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-indigo-700"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Apply Total (₹{total.toLocaleString("en-IN")})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
