"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "../_components/ui";

export function ProductForm({
  initialData,
}: {
  initialData?: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const body = {
      name: formData.get("name") as string,
      category: (formData.get("category") as string) || null,
      brand: (formData.get("brand") as string) || null,
      isActive: formData.get("isActive") === "on",
    };

    try {
      const url = initialData ? `/api/v1/catalog/products/${initialData.id}` : "/api/v1/catalog/products";
      const res = await fetch(url, {
        method: initialData ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
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
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
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

      <div className="flex items-center gap-3 border-t border-slate-100 pt-6">
        <button type="submit" disabled={saving} className={buttonClass("primary")}>
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
