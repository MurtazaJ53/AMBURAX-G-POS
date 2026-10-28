"use client";

import { useState } from "react";
import { X, Calculator, AlertCircle, CheckCircle2, Coins } from "lucide-react";
import { closeAndCountAction, approveVarianceAction } from "./actions";
import { DenominationCalculator } from "./DenominationCalculator";

export function DayCloseModal(props: {
  isOpen: boolean;
  onClose: () => void;
  session: {
    id: string;
    cashierName: string;
    posDeviceName: string;
    expectedCashMinor: number;
    expectedUpiMinor: number;
    expectedCardMinor: number;
  };
}) {
  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState("");
  const [card, setCard] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denomOpen, setDenomOpen] = useState(false);

  if (!props.isOpen) return null;

  const countedCash = parseFloat(cash || "0") * 100;
  const countedUpi = parseFloat(upi || "0") * 100;
  const countedCard = parseFloat(card || "0") * 100;

  const cashDiff = countedCash - props.session.expectedCashMinor;
  const upiDiff = countedUpi - props.session.expectedUpiMinor;
  const cardDiff = countedCard - props.session.expectedCardMinor;
  const totalDiff = cashDiff + upiDiff + cardDiff;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalDiff !== 0 && !note.trim()) {
      setError("Please provide a note explaining the drawer difference.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await closeAndCountAction(
      props.session.id,
      {
        cash: parseFloat(cash || "0"),
        upi: parseFloat(upi || "0"),
        card: parseFloat(card || "0"),
      },
      note
    );

    setSubmitting(false);
    if (res.status === "ok") {
      props.onClose();
    } else {
      setError(res.message || "Failed to close till shift.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">
              Till Close &amp; Count — {props.session.posDeviceName}
            </h3>
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
          Enter the counted physical balances for cashier <strong>{props.session.cashierName}</strong> to finalize the shift and balance the till.
        </p>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-slate-700">Counted Cash (₹)</label>
                <button
                  type="button"
                  onClick={() => setDenomOpen(true)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  <Coins className="h-3 w-3" />
                  <span>Breakdown</span>
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Expected: ₹{(props.session.expectedCashMinor / 100).toFixed(2)}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700">Counted UPI (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={upi}
                onChange={(e) => setUpi(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Expected: ₹{(props.session.expectedUpiMinor / 100).toFixed(2)}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700">Counted Card (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={card}
                onChange={(e) => setCard(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Expected: ₹{(props.session.expectedCardMinor / 100).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600">Drawer Difference:</span>
              <span
                className={`font-mono font-bold ${
                  totalDiff === 0 ? "text-emerald-700" : totalDiff > 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {totalDiff === 0 ? "Balanced (₹0.00)" : `₹${(totalDiff / 100).toFixed(2)}`}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700">
              Reconciliation Note {totalDiff !== 0 && <span className="text-rose-500">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for count variance or closing observation..."
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              rows={2}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Closing Shift..." : "Confirm & Close Till"}
            </button>
          </div>
        </form>

        <DenominationCalculator
          isOpen={denomOpen}
          onClose={() => setDenomOpen(false)}
          onApply={(totalRupees) => {
            setCash(totalRupees.toString());
          }}
        />
      </div>
    </div>
  );
}

export function ApproveVarianceModal(props: {
  isOpen: boolean;
  onClose: () => void;
  session: { id: string; cashierName: string };
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Please provide an approval note.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await approveVarianceAction(props.session.id, note);
    setSubmitting(false);
    if (res.status === "ok") {
      props.onClose();
    } else {
      setError(res.message || "Approval failed.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">Approve Till Variance</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Approve counted cash variance for <strong>{props.session.cashierName}</strong> to allow its Cash Short/Over Journal Entry to post to accounting.
        </p>

        {error && (
          <p className="mt-2 text-xs text-rose-600">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-700">Manager Approval Note</label>
            <textarea
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for approving variance..."
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Approving..." : "Approve Difference"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CashMovementModal(props: {
  isOpen: boolean;
  onClose: () => void;
  session: { id: string; cashierName: string; posDeviceName: string };
}) {
  const [kind, setKind] = useState<"PAY_IN" | "PAY_OUT">("PAY_IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("PETTY_EXPENSE");
  const [payee, setPayee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denomOpen, setDenomOpen] = useState(false);

  if (!props.isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const { cashMovementAction } = await import("./actions");
    const res = await cashMovementAction({
      sessionId: props.session.id,
      kind,
      amountRupees: val,
      reason,
      category: kind === "PAY_OUT" ? category : undefined,
      payee: kind === "PAY_OUT" ? payee : undefined,
    });

    setSubmitting(false);
    if (res.status === "ok") {
      props.onClose();
    } else {
      setError(res.message || "Failed to record cash movement.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Cash Pay In / Out — {props.session.posDeviceName}
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Record manual cash drawer additions or payouts for till <strong>{props.session.posDeviceName}</strong>.
        </p>

        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setKind("PAY_IN")}
              className={`flex-1 rounded-md py-1 text-xs font-bold transition-colors ${
                kind === "PAY_IN" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Pay In (Float/Cash)
            </button>
            <button
              type="button"
              onClick={() => setKind("PAY_OUT")}
              className={`flex-1 rounded-md py-1 text-xs font-bold transition-colors ${
                kind === "PAY_OUT" ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Pay Out (Expense)
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold text-slate-700">Amount (₹)</label>
              {kind === "PAY_IN" && (
                <button
                  type="button"
                  onClick={() => setDenomOpen(true)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  <Coins className="h-3 w-3" />
                  <span>Denomination</span>
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {kind === "PAY_OUT" && (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-700">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="PETTY_EXPENSE">Petty Expense</option>
                  <option value="SUPPLIER_PAYMENT">Supplier Payment</option>
                  <option value="STAFF_ADVANCE">Staff Advance</option>
                  <option value="BANK_DEPOSIT">Bank Deposit</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700">Payee (Name)</label>
                <input
                  type="text"
                  required
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="Who received the cash"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-700">Reason / Description</label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Purpose of this cash movement..."
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Record Movement"}
            </button>
          </div>
        </form>

        <DenominationCalculator
          isOpen={denomOpen}
          onClose={() => setDenomOpen(false)}
          onApply={(totalRupees) => {
            setAmount(totalRupees.toString());
          }}
        />
      </div>
    </div>
  );
}
