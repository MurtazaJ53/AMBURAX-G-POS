"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Hash, FileText, TrendingDown, TrendingUp, Minus } from "lucide-react";

interface VariantOption {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
}

interface Props { stockByVariant: Record<string, number>; 
  variants: VariantOption[];
  storeId: string;
}

export function AdjustStockForm({ variants, storeId, stockByVariant }: Props) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);
  const requestKeyRef = React.useRef<string | null>(null);

  const [selectedVariantId, setSelectedVariantId] = React.useState("");
  const [deltaRaw, setDeltaRaw] = React.useState("");

  const currentStock = selectedVariantId ? (stockByVariant[selectedVariantId] ?? 0) : null;

  const deltaNum = deltaRaw ? parseInt(deltaRaw, 10) : null;
  const resultStock =
    currentStock !== null && deltaNum !== null && !isNaN(deltaNum)
      ? currentStock + deltaNum
      : null;
  const deltaIsPositive = deltaNum !== null && !isNaN(deltaNum) && deltaNum > 0;
  const deltaIsNegative = deltaNum !== null && !isNaN(deltaNum) && deltaNum < 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!deltaNum || deltaNum === 0) {
      setError("Adjustment quantity must be non-zero.");
      return;
    }

    setError("");
    setLoading(true);

    if (!requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID();
    }

    const formData = new FormData(e.currentTarget);
    const variantId = formData.get("variantId") as string;
    const quantityDelta = parseInt(formData.get("quantityDelta") as string, 10);
    const reason = formData.get("reason") as string;

    const payload = {
      storeId,
      variantId,
      quantityDelta,
      reason,
      requestKey: requestKeyRef.current,
    };

    try {
      const res = await fetch("/api/v1/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to adjust stock");
        setLoading(false);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/inventory?success=adjustment_created");
          router.refresh();
        }, 1500);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden p-12 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 mb-6">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Adjustment Recorded</h2>
        <p className="mt-2 text-slate-500">Stock has been updated. Redirecting...</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Adjust Stock</h1>
          <p className="text-sm text-slate-500 mt-1">
            Correct inventory levels due to damage, loss, shrinkage, or data-entry errors. A reason is required for every adjustment.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 p-4 border border-red-200">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-1 text-sm text-red-700">{error}</div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="variantId" className="block text-sm font-medium text-slate-900">
              Product / Variant
            </label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Package className="h-4 w-4 text-slate-400" />
              </div>
              <select
                id="variantId"
                name="variantId"
                required
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 pl-10 pr-10 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none"
              >
                <option value="">Select a variant...</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} • {v.sku}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
            {variants.length === 0 && (
              <p className="text-xs text-red-500 mt-1">No active variants found in this store.</p>
            )}
          </div>

          {currentStock !== null && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 text-center">
                Stock Preview
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Current</p>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{currentStock}</p>
                </div>
                <div className="flex flex-col items-center justify-center space-y-1 relative">
                  {deltaIsPositive ? (
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                  ) : deltaIsNegative ? (
                    <TrendingDown className="h-5 w-5 text-rose-500" />
                  ) : (
                    <Minus className="h-5 w-5 text-slate-300" />
                  )}
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      deltaIsPositive
                        ? "text-emerald-600"
                        : deltaIsNegative
                          ? "text-rose-600"
                          : "text-slate-400"
                    }`}
                  >
                    {deltaNum !== null && !isNaN(deltaNum)
                      ? (deltaNum > 0 ? "+" : "") + deltaNum
                      : "-"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">Result</p>
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      resultStock !== null && resultStock < 0
                        ? "text-rose-600"
                        : "text-slate-900"
                    }`}
                  >
                    {resultStock !== null ? resultStock : "-"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="quantityDelta" className="block text-sm font-medium text-slate-900">
              Adjustment Quantity
            </label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Hash className="h-4 w-4 text-slate-400" />
              </div>
              <Input
                type="number"
                name="quantityDelta"
                id="quantityDelta"
                required
                placeholder="e.g. -3 or +5"
                value={deltaRaw}
                onChange={(e) => setDeltaRaw(e.target.value)}
                className="pl-10 block w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Use a <strong>negative</strong> number to write stock off, and a <strong>positive</strong> number to correct an undercount. Cannot be 0.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="reason" className="block text-sm font-medium text-slate-900">
              Reason <span className="text-rose-500" aria-label="required">*</span>
            </label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <FileText className="h-4 w-4 text-slate-400" />
              </div>
              <Input
                type="text"
                name="reason"
                id="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="e.g. Damaged goods, inventory count correction"
                className="pl-10 block w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Required. An unexplained adjustment is indistinguishable from a mistake.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/inventory")}
            disabled={loading}
            className="rounded-lg bg-white shadow-sm hover:bg-slate-50"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading || variants.length === 0}
            className="rounded-lg shadow-sm"
          >
            {loading ? "Adjusting..." : "Adjust Stock"}
          </Button>
        </div>
      </div>
    </form>
  );
}
