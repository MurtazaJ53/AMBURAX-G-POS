"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { UploadCloud, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { buttonClass } from "../_components/ui";

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().nullable().optional(),
  brand: z.string().trim().nullable().optional(),
  baseUomId: z.string().min(1, "Base unit of measure is required"),
  isActive: z.boolean().default(true),
  imageUrl: z.string().nullable().optional(),
  variant: z.object({
    sku: z.string().trim().min(1, "SKU is required"),
    barcode: z.string().trim().nullable().optional(),
    size: z.string().trim().nullable().optional(),
    colour: z.string().trim().nullable().optional(),
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
    imageUrl?: string | null;
  };
  uoms?: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  
  // Image Upload State
  const [imageUrl, setImageUrl] = useState<string | null>(initialData?.imageUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type and size
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setUploadError("Invalid file type. Only JPEG, PNG, and WebP are allowed.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File exceeds 5MB limit.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/v1/catalog/images", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.message || "Upload failed");
      } else {
        const data = await res.json();
        setImageUrl(data.url);
      }
    } catch (err) {
      setUploadError("Network error during upload");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    setImageUrl(null);
    setUploadError(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const priceStr = formData.get("price") as string;
    const mrpStr = formData.get("mrp") as string;
    
    const isCreate = !initialData;

    let payload: any = {
      name: formData.get("name") as string,
      category: (formData.get("category") as string) || null,
      brand: (formData.get("brand") as string) || null,
      baseUomId: formData.get("baseUomId") as string,
      isActive: formData.get("isActive") === "on",
      imageUrl: imageUrl,
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
        
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Image Upload Area */}
          <div className="shrink-0">
            <label className="block text-sm font-medium text-slate-900 mb-1">Image</label>
            <div className="relative group w-32 h-32 sm:w-40 sm:h-40 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden transition-colors hover:border-blue-400 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={handleImageUpload}
                disabled={isUploading}
                aria-label="Upload Product Image"
              />
              
              {isUploading ? (
                <div className="flex flex-col items-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-1" />
                  <span className="text-xs font-medium">Uploading...</span>
                </div>
              ) : imageUrl ? (
                <>
                  <img src={imageUrl} alt="Product preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="text-white text-xs font-medium">Replace</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-slate-400">
                  <UploadCloud className="w-6 h-6 mb-1 group-hover:text-blue-500 transition-colors" />
                  <span className="text-xs font-medium text-center px-2 group-hover:text-blue-600 transition-colors">Click or Drag</span>
                </div>
              )}
            </div>
            
            {imageUrl && !isUploading && (
              <button
                type="button"
                onClick={handleRemoveImage}
                className="mt-2 text-xs text-red-600 hover:text-red-700 flex items-center justify-center w-full"
                aria-label="Remove image"
              >
                <X className="w-3 h-3 mr-1" />
                Remove
              </button>
            )}
            
            {uploadError && (
              <p className="mt-1 text-xs text-red-600 max-w-[160px]">{uploadError}</p>
            )}
          </div>

          <div className="flex-1 space-y-4">
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
        <button type="submit" disabled={saving || isUploading} aria-busy={saving || isUploading} className={buttonClass("primary")}>
          {saving ? "Saving..." : initialData ? "Save Changes" : "Create Product"}
        </button>
        <button
          type="button"
          disabled={saving || isUploading}
          onClick={() => router.back()}
          className={buttonClass("secondary")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

