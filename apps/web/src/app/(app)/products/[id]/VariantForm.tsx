"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "../../_components/ui";

export function VariantForm(props: {
  productId: string;
  variant?: {
    id: string;
    sku: string;
    barcode: string | null;
    size: string | null;
    colour: string | null;
    priceMinor: number | null;
    mrpMinor: number | null;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const v = props.variant;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const priceStr = formData.get("priceMinor") as string;
    const mrpStr = formData.get("mrpMinor") as string;

    const payload = {
      sku: formData.get("sku") as string,
      barcode: (formData.get("barcode") as string) || null,
      size: (formData.get("size") as string) || null,
      colour: (formData.get("colour") as string) || null,
      priceMinor: priceStr ? Math.round(parseFloat(priceStr) * 100) : null,
      mrpMinor: mrpStr ? Math.round(parseFloat(mrpStr) * 100) : null,
      isActive: formData.get("isActive") === "on",
    };

    try {
      const url = v
        ? `/api/v1/catalog/variants/${v.id}`
        : `/api/v1/catalog/products/${props.productId}/variants`;
      const res = await fetch(url, {
        method: v ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to save variant");
      }

      router.push(`/products/${props.productId}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="sku" className="block text-sm font-medium text-slate-700">
            SKU (Required)
          </label>
          <input
            id="sku"
            name="sku"
            required
            defaultValue={v?.sku ?? ""}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="barcode" className="block text-sm font-medium text-slate-700">
            Barcode
          </label>
          <input
            id="barcode"
            name="barcode"
            defaultValue={v?.barcode ?? ""}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="size" className="block text-sm font-medium text-slate-700">
            Size
          </label>
          <input
            id="size"
            name="size"
            defaultValue={v?.size ?? ""}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="colour" className="block text-sm font-medium text-slate-700">
            Colour
          </label>
          <input
            id="colour"
            name="colour"
            defaultValue={v?.colour ?? ""}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="priceMinor" className="block text-sm font-medium text-slate-700">
            Price (₹)
          </label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">₹</span>
            <input
              id="priceMinor"
              name="priceMinor"
              type="number"
              step="0.01"
              min="0"
              defaultValue={v?.priceMinor ? (v.priceMinor / 100).toFixed(2) : ""}
              className="block w-full rounded-md border border-slate-300 pl-7 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="mrpMinor" className="block text-sm font-medium text-slate-700">
            MRP (₹)
          </label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">₹</span>
            <input
              id="mrpMinor"
              name="mrpMinor"
              type="number"
              step="0.01"
              min="0"
              defaultValue={v?.mrpMinor ? (v.mrpMinor / 100).toFixed(2) : ""}
              className="block w-full rounded-md border border-slate-300 pl-7 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          name="isActive"
          defaultChecked={v ? v.isActive : true}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="isActive" className="text-sm font-medium text-slate-700">
          Variant is active
        </label>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
        <button
          type="button"
          onClick={() => router.back()}
          className={buttonClass("secondary")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className={buttonClass("primary")}
        >
          {isSubmitting ? "Saving..." : "Save Variant"}
        </button>
      </div>
    </form>
  );
}

