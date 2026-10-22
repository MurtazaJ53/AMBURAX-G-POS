"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, ShieldAlert, KeyRound, Loader2, Check } from "lucide-react";

interface Approver {
  id: string;
  name: string;
}

interface CancelBillModalProps {
  saleId: string;
  billNumber: string;
  approvers: Approver[];
  isOwnerOrManager: boolean;
  isSameDay: boolean;
  tile?: boolean;
}

export function CancelBillModal({
  saleId,
  billNumber,
  approvers,
  isOwnerOrManager,
  isSameDay,
  tile = false,
}: CancelBillModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState(approvers[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPin = !isSameDay || !isOwnerOrManager;

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("Please specify the reason for cancelling this bill.");
      return;
    }
    if (needsPin && !pin.trim()) {
      setError("Manager approval PIN is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/sales/${saleId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          approval: needsPin ? { approverUserId: approverId, pin: pin.trim() } : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "Failed to cancel bill.");
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const buttonStyle = tile
    ? "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-[13px] font-semibold text-rose-700 hover:bg-rose-100 hover:border-rose-300 transition-colors"
    : "inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-[13px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`amb-press ${buttonStyle}`}>
        <XCircle className="h-4 w-4" />
        Cancel Bill
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cancel &amp; Void Bill</h3>
                <p className="text-xs text-slate-500 font-mono">Invoice #{billNumber}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              This action will mark the transaction as <strong>VOIDED</strong>, restore all item quantities back to stock via inventory ledger reversals, and void registered payment receipts.
            </p>

            <form onSubmit={handleCancel} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cancellation Reason *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Customer cancelled order / Wrong barcode scanned"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              {needsPin && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <KeyRound className="h-4 w-4 text-amber-700" />
                    Manager Authorization Required
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Approver</label>
                      <select
                        value={approverId}
                        onChange={(e) => setApproverId(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800"
                      >
                        {approvers.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Manager PIN</label>
                      <input
                        type="password"
                        maxLength={6}
                        placeholder="••••"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-center text-xs tracking-widest font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700 border border-rose-200">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                  className="h-9 rounded-lg px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="amb-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
