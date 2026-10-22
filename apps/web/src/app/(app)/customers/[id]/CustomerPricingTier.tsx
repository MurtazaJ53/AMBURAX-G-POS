"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { apiRequest } from "@/client/platform/apiClient";

interface PriceListOption {
  id: string;
  name: string;
  currency: string;
}

export function CustomerPricingTier(props: {
  customerId: string;
  currentPriceListId: string | null;
  availablePriceLists: PriceListOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(props.currentPriceListId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const currentList = props.availablePriceLists.find((pl) => pl.id === props.currentPriceListId);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const targetId = selectedId.trim() === "" ? null : selectedId;
      await apiRequest(`/api/v1/customers/${encodeURIComponent(props.customerId)}/price-list`, {
        method: "POST",
        body: { priceListId: targetId },
      });
      setSuccess(true);
      router.refresh();
      setTimeout(() => setSuccess(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update pricing tier";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!props.canManage) {
    return (
      <div className="flex justify-between gap-4 px-5 py-3 text-sm">
        <dt className="text-slate-600">Trade pricing tier</dt>
        <dd className="font-semibold text-slate-900">
          {currentList ? `${currentList.name} (${currentList.currency})` : "Standard Retail"}
        </dd>
      </div>
    );
  }

  const hasChanged = (props.currentPriceListId ?? "") !== selectedId;

  return (
    <div className="border-t border-slate-100 px-5 py-3.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          <Tag className="h-4 w-4 text-slate-400" />
          Trade Pricing Tier
        </span>
        {currentList && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
            Active: {currentList.name}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Assign a B2B wholesale / trade price list to override retail shelf pricing during checkout.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={loading}
          className="amb-focus min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:opacity-50"
        >
          <option value="">Standard Retail (Tenant Default)</option>
          {props.availablePriceLists.map((pl) => (
            <option key={pl.id} value={pl.id}>
              {pl.name} ({pl.currency})
            </option>
          ))}
        </select>

        {hasChanged && (
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="amb-focus amb-press min-h-10 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save Tier"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {success && <p className="mt-2 text-xs font-medium text-emerald-600">Pricing tier updated successfully.</p>}
    </div>
  );
}
