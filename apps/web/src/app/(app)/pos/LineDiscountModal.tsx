"use client";

import { useState } from "react";
import { X, Percent, IndianRupee, Tag, ShieldAlert } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

export interface LineDiscountModalProps {
  isOpen: boolean;
  onClose: () => void;
  line: {
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    originalUnitPriceMinor?: number;
  } | null;
  /** Maximum cashier percentage allowed without manager PIN (defaults to 10%) */
  maxCashierDiscountPercent?: number;
  mayGiveLargeDiscount?: boolean;
  onApply: (discountedUnitPriceMinor: number, reason: string) => void;
  onReset: () => void;
}

export function LineDiscountModal({
  isOpen,
  onClose,
  line,
  maxCashierDiscountPercent = 10,
  mayGiveLargeDiscount = false,
  onApply,
  onReset,
}: LineDiscountModalProps) {
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [valueRaw, setValueRaw] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !line) return null;

  const basePriceMinor = line.originalUnitPriceMinor ?? line.unitPriceMinor;
  const numVal = parseFloat(valueRaw) || 0;

  // Calculate discount per unit
  let discountPerUnitMinor = 0;
  if (kind === "percent") {
    discountPerUnitMinor = Math.round((basePriceMinor * numVal) / 100);
  } else {
    discountPerUnitMinor = Math.round(numVal * 100);
  }

  discountPerUnitMinor = Math.max(0, Math.min(discountPerUnitMinor, basePriceMinor));
  const newUnitPriceMinor = basePriceMinor - discountPerUnitMinor;
  const lineTotalSavingMinor = discountPerUnitMinor * line.quantity;
  const percentApplied = basePriceMinor > 0 ? (discountPerUnitMinor / basePriceMinor) * 100 : 0;
  const exceedsCashierCap = !mayGiveLargeDiscount && percentApplied > maxCashierDiscountPercent;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (numVal <= 0) {
      setError("Please enter a discount greater than zero.");
      return;
    }

    if (kind === "percent" && numVal > 100) {
      setError("Percentage discount cannot exceed 100%.");
      return;
    }

    if (discountPerUnitMinor >= basePriceMinor) {
      setError("Discount cannot be 100% or equal/greater than unit price.");
      return;
    }

    if (exceedsCashierCap) {
      setError(
        `Cashier limit is ${maxCashierDiscountPercent}%. A higher line discount requires manager approval on bill level.`
      );
      return;
    }

    if (!reason.trim()) {
      setError("Please specify a reason for this line discount (e.g. Minor flaw, Clearance).");
      return;
    }

    onApply(newUnitPriceMinor, reason.trim());
    onClose();
  }

  function handleResetLine() {
    onReset();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="line-discount-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-sky-600" />
            <h3 id="line-discount-title" className="text-base font-bold text-slate-900">
              Item-Level Line Discount
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

        {/* Item context banner */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-900">{line.productName}</p>
              <p className="text-[11px] text-slate-500 font-mono">SKU: {line.sku} · Qty: {line.quantity}</p>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Original MRP</span>
              <span className="text-xs font-bold text-slate-900 font-mono">{formatMinor(basePriceMinor)}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">Discount Type</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setKind("percent");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-bold transition-all ${
                  kind === "percent"
                    ? "border-sky-600 bg-sky-50 text-sky-700 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Percent className="h-3.5 w-3.5" />
                <span>Percentage (%)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setKind("amount");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-bold transition-all ${
                  kind === "amount"
                    ? "border-sky-600 bg-sky-50 text-sky-700 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <IndianRupee className="h-3.5 w-3.5" />
                <span>Flat Rupee (₹)</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              {kind === "percent" ? "Discount Percentage" : "Discount Amount (₹ per unit)"}
            </label>
            <div className="mt-1 relative">
              <input
                type="number"
                step={kind === "percent" ? "0.5" : "1"}
                min="0"
                value={valueRaw}
                onChange={(e) => {
                  setValueRaw(e.target.value);
                  setError(null);
                }}
                placeholder={kind === "percent" ? "e.g. 5, 10" : "e.g. 50, 100"}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                autoFocus
              />
              {kind === "percent" && (
                <div className="mt-1.5 flex gap-1.5">
                  {[3, 5, 10, 15].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        setValueRaw(pct.toString());
                        setError(null);
                      }}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">Reason for Line Discount</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Seasonal deal, Minor seam stitch, Counter privilege"
              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          {/* Impact preview */}
          {numVal > 0 && (
            <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>New Unit Price:</span>
                <span className="font-bold text-slate-900 font-mono">{formatMinor(newUnitPriceMinor)}</span>
              </div>
              <div className="flex justify-between text-slate-600 mt-1">
                <span>Total Line Savings ({line.quantity} units):</span>
                <span className="font-bold text-emerald-700 font-mono">−{formatMinor(lineTotalSavingMinor)}</span>
              </div>
              <div className="flex justify-between text-slate-600 mt-1">
                <span>Effective Rate:</span>
                <span className="font-semibold text-slate-800">{percentApplied.toFixed(1)}% off</span>
              </div>
            </div>
          )}

          {exceedsCashierCap && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 border border-amber-200">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Discount exceeds standard cashier cap ({maxCashierDiscountPercent}%). Must be applied under manager approval.
              </span>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700 border border-rose-200">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            {line.originalUnitPriceMinor && line.originalUnitPriceMinor !== line.unitPriceMinor && (
              <button
                type="button"
                onClick={handleResetLine}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Reset to MRP
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-hover transition-colors"
            >
              Apply Discount
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
