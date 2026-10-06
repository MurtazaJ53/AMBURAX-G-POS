"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { buttonClass } from "../_components/ui";

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  baseUomId: z.string().min(1, "Base unit of measure is required"),
  isActive: z.boolean().default(true),
  variant: z.object({
    sku: z.string().trim().min(1, "SKU is required"),
    barcode: z.string().trim().optional(),
    size: z.string().trim().optional(),
    colour: z.string().trim().optional(),
    priceMinor: z.number().min(0, "Price cannot be negative"),
    mrpMinor: z.number().min(0, "MRP cannot be negative").nullable().optional(),
    isActive: z.boolean().default(true),
  })
});

export function ProductForm({
  initialData,
  uoms = []
}: {
  initialData?: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    baseUomId: string | null;
    isActive: boolean;
  };
  uoms?: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const priceStr = formData.get("price") as string;
    const mrpStr = formData.get("mrp") as string;
    
    // In edit mode (initialData provided), we just update the product. 
    // Wait, the API for updating product hasn't changed.
    // The prompt only asked to unify CREATE product. I'll preserve edit just in case, but edit doesn't require a variant if it already has one.
    // Actually, the API I modified was just POST /api/v1/catalog/products. 
    // I should only enforce variant rules if we are creating.
    const isCreate = !initialData;

    let payload: any = {
      name: formData.get("name") as string,
      category: (formData.get("category") as string) || null,
      brand: (formData.get("brand") as string) || null,
      baseUomId: formData.get("baseUomId") as string,
      isActive: formData.get("isActive") === "on",
    };

    if (isCreate) {
      payload.variant = {
        sku: formData.get("sku") as string,
        barcode: (formData.get("barcode") as string) || null,
        size: (formData.get("size") as string) || null,
        colour: (formData.get("colour") as string) || null,
        priceMinor: priceStr ? Math.round(parseFloat(priceStr) * 100) : 0,
        mrpMinor: mrpStr ? Math.round(parseFloat(mrpStr) * 100) : null,
        isActive: formData.get("variantIsActive") === "on",
      };

      const parsed = productSchema.safeParse(payload);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const path = issue.path.join(".");
          errors[path] = issue.message;
        }
        setFieldErrors(errors);
        setSaving(false);
        // Focus first invalid field manually if needed, or rely on visual cues
        return;
      }
    }

    try {
      const url = initialData ? `/api/v1/catalog/products/${initialData.id}` : "/api/v1/catalog/products";
      const res = await fetch(url, {
        method: initialData ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Failed to save product");
        setSaving(false);
        return;
      }

      router.refresh();
      if (initialData) {
        router.push(`/products/${initialData.id}`);
      } else {
        const data = await res.json();
        router.push(`/products/${data.productId}`);
      }
    } catch (err) {
      setError("An unexpected error occurred.");
      setSaving(false);
    }
  }

  const isCreate = !initialData;

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-8" noValidate>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-slate-900 border-b pb-2">Product Details</h3>
        
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-900">
            Product Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={initialData?.name}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${fieldErrors.name ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-blue-500"}`}
          />
          {fieldErrors.name && (
            <p id="name-error" className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="block text-sm font-medium text-slate-900">
              Category
            </label>
            <input
              id="category"
              name="category"
              type="text"
              defaultValue={initialData?.category || ""}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label htmlFor="brand" className="block text-sm font-medium text-slate-900">
              Brand
            </label>
            <input
              id="brand"
              name="brand"
              type="text"
              defaultValue={initialData?.brand || ""}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div>
          <label htmlFor="baseUomId" className="block text-sm font-medium text-slate-900">
            Base Unit of Measure <span className="text-red-500">*</span>
          </label>
          <select
            id="baseUomId"
            name="baseUomId"
            required
            defaultValue={initialData?.baseUomId || ""}
            aria-invalid={!!fieldErrors.baseUomId}
            aria-describedby={fieldErrors.baseUomId ? "baseUomId-error" : undefined}
            className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${fieldErrors.baseUomId ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-blue-500"}`}
          >
            <option value="" disabled>Select a unit...</option>
            {uoms.map(uom => (
              <option key={uom.id} value={uom.id}>{uom.name} ({uom.code})</option>
            ))}
          </select>
          {fieldErrors.baseUomId && (
            <p id="baseUomId-error" className="mt-1 text-xs text-red-600">{fieldErrors.baseUomId}</p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input
            id="isActive"
            name="isActive"
            type="checkbox"
            defaultChecked={initialData ? initialData.isActive : true}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <label htmlFor="isActive" className="text-sm font-medium text-slate-900">
            Active (available for sale)
          </label>
        </div>
      </div>

      {isCreate && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900 border-b pb-2">First Variant</h3>
          <p className="text-xs text-slate-500 mb-4">Every product needs at least one variant to be sellable.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sku" className="block text-sm font-medium text-slate-900">
                SKU <span className="text-red-500">*</span>
              </label>
              <input
                id="sku"
                name="sku"
                type="text"
                required
                aria-invalid={!!fieldErrors["variant.sku"]}
                aria-describedby={fieldErrors["variant.sku"] ? "sku-error" : undefined}
                className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${fieldErrors["variant.sku"] ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-blue-500"}`}
              />
              {fieldErrors["variant.sku"] && (
                <p id="sku-error" className="mt-1 text-xs text-red-600">{fieldErrors["variant.sku"]}</p>
              )}
            </div>

            <div>
              <label htmlFor="barcode" className="block text-sm font-medium text-slate-900">
                Barcode
              </label>
              <input
                id="barcode"
                name="barcode"
                type="text"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label htmlFor="price" className="block text-sm font-medium text-slate-900">
                Selling Price (₹) <span className="text-red-500">*</span>
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">₹</span>
                <input
                  id="price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  aria-invalid={!!fieldErrors["variant.priceMinor"]}
                  aria-describedby={fieldErrors["variant.priceMinor"] ? "price-error" : undefined}
                  className={`block w-full rounded-lg border pl-7 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${fieldErrors["variant.priceMinor"] ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-blue-500"}`}
                />
              </div>
              {fieldErrors["variant.priceMinor"] && (
                <p id="price-error" className="mt-1 text-xs text-red-600">{fieldErrors["variant.priceMinor"]}</p>
              )}
            </div>

            <div>
              <label htmlFor="mrp" className="block text-sm font-medium text-slate-900">
                MRP (₹)
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">₹</span>
                <input
                  id="mrp"
                  name="mrp"
                  type="number"
                  step="0.01"
                  min="0"
                  className="block w-full rounded-lg border border-slate-300 pl-7 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="size" className="block text-sm font-medium text-slate-900">
                Size
              </label>
              <input
                id="size"
                name="size"
                type="text"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label htmlFor="colour" className="block text-sm font-medium text-slate-900">
                Colour
              </label>
              <input
                id="colour"
                name="colour"
                type="text"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 pt-2">
            <input
              id="variantIsActive"
              name="variantIsActive"
              type="checkbox"
              defaultChecked={true}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <label htmlFor="variantIsActive" className="text-sm font-medium text-slate-900">
              Variant is active
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-slate-100 pt-6">
        <button type="submit" disabled={saving} aria-busy={saving} className={buttonClass("primary")}>
          {saving ? "Saving..." : initialData ? "Save Changes" : "Create Product"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.back()}
          className={buttonClass("secondary")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
