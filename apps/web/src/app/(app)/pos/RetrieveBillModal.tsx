"use client";

import { useEffect, useState } from "react";
import { formatMinor } from "@/server/sales/saleTotals";
import { X, History, Trash2, Clock, User, Package } from "lucide-react";

interface HeldBillItem {
  id: string;
  variantId: string;
  quantity: number;
  variant: {
    id: string;
    sku: string;
    size: string | null;
    colour: string | null;
    priceMinor: number;
    mrpMinor: number | null;
    taxRateBp: number;
    product: {
      name: string;
      imageUrl: string | null;
    };
  };
}

export interface HeldBill {
  id: string;
  tenantId: string;
  storeId: string;
  createdAt: string;
  version: number;
  heldByUser: {
    id: string;
    name: string;
  };
  items: HeldBillItem[];
}

interface RetrieveBillModalProps {
  open: boolean;
  onClose: () => void;
  onRetrieve: (bill: HeldBill) => void;
}

export function RetrieveBillModal({ open, onClose, onRetrieve }: RetrieveBillModalProps) {
  const [bills, setBills] = useState<HeldBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBills = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sales/held-bills");
      if (!res.ok) {
        throw new Error("Failed to load held bills");
      }
      const data = await res.json();
      setBills(data.heldBills || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchBills();
    }
  }, [open]);

  const handleDiscard = async (bill: HeldBill) => {
    if (!window.confirm("Are you sure you want to discard this held bill?")) return;
    try {
      const res = await fetch(`/api/v1/sales/held-bills/${bill.id}/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: bill.version }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || "Failed to discard bill");
      }
      fetchBills();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRetrieve = async (bill: HeldBill) => {
    try {
      const res = await fetch(`/api/v1/sales/held-bills/${bill.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: bill.version }),
      });
      // Read body once — the stream can only be consumed once
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to resume bill");
      }
      // Use the full bill from the resume response: it includes variant+product data
      // needed to restore the cart. The list-version bill only carries minimal variant info.
      onRetrieve(data?.heldBill ?? bill);
    } catch (err: any) {
      alert(err.message);
      fetchBills(); // refresh list in case it was already claimed
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-2xl transform overflow-hidden rounded-xl bg-white text-left shadow-2xl transition-all">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <History className="h-5 w-5 text-sky-600" />
            Retrieve Held Bill
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <p className="text-sm text-slate-500">Loading held bills...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-rose-50 p-4 text-rose-700">
              <p className="text-sm">{error}</p>
            </div>
          ) : bills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="mb-4 h-12 w-12 text-slate-300" />
              <h4 className="text-[15px] font-medium text-slate-900">No held bills</h4>
              <p className="mt-1 text-sm text-slate-500">
                There are no currently parked bills in this store.
              </p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              <ul className="space-y-3">
                {bills.map((bill) => {
                  const totalItems = bill.items.reduce((sum, item) => sum + item.quantity, 0);
                  const totalMinor = bill.items.reduce(
                    (sum, item) => sum + item.quantity * item.variant.priceMinor,
                    0,
                  );
                  return (
                    <li
                      key={bill.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3 text-[13px] text-slate-600">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(bill.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {bill.heldByUser?.name || "Unknown"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-medium text-slate-900">
                          <Package className="h-4 w-4 text-slate-400" />
                          {totalItems} item{totalItems === 1 ? "" : "s"} —{" "}
                          {formatMinor(totalMinor)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDiscard(bill)}
                          title="Discard Bill"
                          className="rounded-lg border border-rose-200 bg-white p-2.5 text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRetrieve(bill)}
                          className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
                        >
                          Resume
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
