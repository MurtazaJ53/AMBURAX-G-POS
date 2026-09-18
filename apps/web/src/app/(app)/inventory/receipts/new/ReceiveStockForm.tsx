"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, buttonClass } from "../../../_components/ui";

export function ReceiveStockForm({ variants, storeId }: { variants: any[], storeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const variantId = formData.get("variantId") as string;
    const quantity = parseInt(formData.get("quantity") as string, 10);
    const reason = formData.get("reason") as string;

    const payload = {
      storeId,
      variantId,
      quantity,
      reason,
      requestKey: crypto.randomUUID()
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
        router.push("/inventory");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <div className="mt-2 text-sm text-red-700">{error}</div>
          </div>
        )}

        <div>
          <label htmlFor="variantId" className="block text-sm font-medium leading-6 text-slate-900">
            Product / Variant
          </label>
          <select
            id="variantId"
            name="variantId"
            required
            className="mt-2 block w-full rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
          >
            <option value="">Select a variant...</option>
            {variants.map(v => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.sku})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="quantity" className="block text-sm font-medium leading-6 text-slate-900">
            Quantity
          </label>
          <div className="mt-2">
            <input
              type="number"
              name="quantity"
              id="quantity"
              min="1"
              required
              className="block w-full rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
            />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Must be a positive integer.
          </p>
        </div>

        <div>
          <label htmlFor="reason" className="block text-sm font-medium leading-6 text-slate-900">
            Reference / Reason (Optional)
          </label>
          <div className="mt-2">
            <input
              type="text"
              name="reason"
              id="reason"
              maxLength={500}
              className="block w-full rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={loading}
            className={buttonClass("primary")}
          >
            {loading ? "Receiving..." : "Receive Stock"}
          </button>
        </div>
      </form>
    </Card>
  );
}
