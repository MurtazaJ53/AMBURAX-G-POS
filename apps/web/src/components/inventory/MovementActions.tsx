"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function MovementActions({
  movementId,
  referenceType,
  referenceId,
  canManage,
}: {
  movementId: string;
  referenceType?: string | null;
  referenceId?: string | null;
  canManage: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (!canManage) return null;

  // We allow deletion/reversal if it's a purchase receipt or test movement
  const isPurchase = referenceType === "PURCHASE_RECEIPT" && Boolean(referenceId);

  const handleDelete = async () => {
    const confirmMsg = isPurchase
      ? "Are you sure you want to remove this purchase receipt movement and revert the stock balance?"
      : "Are you sure you want to remove this movement?";
    
    if (!confirm(confirmMsg)) return;

    setLoading(true);
    try {
      if (isPurchase && referenceId) {
        const res = await fetch("/api/v1/inventory/movements/delete-test-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptId: referenceId }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Failed to remove movement.");
          setLoading(false);
          return;
        }
      }
      router.refresh();
    } catch (err: any) {
      alert(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (!isPurchase) return null;

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      title="Remove this movement and revert stock"
      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
