"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Hash, FileText } from "lucide-react";

interface VariantOption {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
}

export function ReceiveStockForm({ variants, storeId }: { variants: VariantOption[], storeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestKeyRef = React.useRef<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID();
    }

    const formData = new FormData(e.currentTarget);
    const variantId = formData.get("variantId") as string;
    const quantity = parseInt(formData.get("quantity") as string, 10);
    const reason = formData.get("reason") as string;

    const payload = {
      storeId,
      variantId,
      quantity,
      reason,
      requestKey: requestKeyRef.current
    };

    try {
      const res = await fetch("/api/v1/inventory/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to receive stock");
        setLoading(false);
      } else {
        router.push("/inventory?success=receipt_created");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Receive Stock</h1>
          <p className="text-sm text-slate-500 mt-1">
            Record incoming stock for products. This will immediately increase the available inventory in this store.
          </p>
        </div>
        
        <div className="p-6 space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-200">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-1 text-sm text-red-700">{error}</div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <label htmlFor="variantId" className="block text-sm font-medium text-slate-900">
                Product Variant
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Package className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  id="variantId"
                  name="variantId"
                  required
                  className="block w-full rounded-lg border border-slate-300 pl-10 pr-10 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none"
                >
                  <option value="">Select a variant...</option>
                  {variants.map(v => (
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

            <div className="space-y-2">
              <label htmlFor="quantity" className="block text-sm font-medium text-slate-900">
                Quantity to Receive
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Hash className="h-4 w-4 text-slate-400" />
                </div>
                <Input
                  type="number"
                  name="quantity"
                  id="quantity"
                  min="1"
                  required
                  placeholder="e.g. 50"
                  className="pl-10 block w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500/20"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Must be a positive integer matching the base unit.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="reason" className="block text-sm font-medium text-slate-900">
                Reference / Reason <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative mt-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <FileText className="h-4 w-4 text-slate-400" />
                </div>
                <Input
                  type="text"
                  name="reason"
                  id="reason"
                  maxLength={500}
                  placeholder="e.g. PO-2026-09-19"
                  className="pl-10 block w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500/20"
                />
              </div>
            </div>
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
            {loading ? "Receiving..." : "Receive Stock"}
          </Button>
        </div>
      </div>
    </form>
  );
}
