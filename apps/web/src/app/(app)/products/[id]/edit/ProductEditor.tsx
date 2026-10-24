"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Layers,
  Percent,
  Barcode,
  Save,
  AlertCircle,
  Plus,
  Trash2,
  Sparkles,
  Camera,
  Check,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { buttonClass, StatusBadge, BadgeTone } from "../../../_components/ui";
import { ProductImagePicker } from "../../_components/ProductImagePicker";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";
import type { DuplicateCheckMatch } from "@/app/api/v1/catalog/products/check-name/route";

interface StoreOption {
  id: string;
  name: string;
  code: string;
}

interface AttributeValueOption {
  id: string;
  value: string;
  code: string;
  colorHex: string | null;
}

interface AttributeDefOption {
  id: string;
  name: string;
  code: string;
  values: AttributeValueOption[];
}

interface SizeGroupOption {
  id: string;
  name: string;
  code: string;
  sizes: Array<{ id: string; name: string; code: string }>;
}

interface ProductEditorProps {
  initialData: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    imageUrl: string | null;
    hsnCode?: string | null;
    isActive: boolean;
    baseUomId: string | null;
    updatedAt: string | Date;
    variants: Array<{
      id: string;
      sku: string;
      barcode: string | null;
      size: string | null;
      colour: string | null;
      costPriceMinor: number | null;
      priceMinor: number | null;
      mrpMinor: number | null;
      taxRateBp: number;
      taxRateMode: string;
      taxTreatment: string;
      isActive: boolean;
      stockQuantity: number | null;
    }>;
  };
  uoms: Array<{ id: string; name: string; code: string }>;
  stores: StoreOption[];
  attributeDefinitions: AttributeDefOption[];
  sizeGroups: SizeGroupOption[];
  categories?: string[];
  brands?: string[];
  slabLabel?: string;
}

export function ProductEditor({
  initialData,
  uoms,
  stores,
  attributeDefinitions,
  sizeGroups,
  categories = [],
  brands = [],
  slabLabel = "Garment slab (5% ≤₹2500, 18% >₹2500)",
}: ProductEditorProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Basics
  const [name, setName] = useState(initialData.name);
  const [category, setCategory] = useState(initialData.category || "");
  const [brand, setBrand] = useState(initialData.brand || "");
  const [baseUomId, setBaseUomId] = useState(initialData.baseUomId || uoms[0]?.id || "");
  const [imageUrl, setImageUrl] = useState(initialData.imageUrl || "");
  const [isActive, setIsActive] = useState(initialData.isActive);

  // Debounced duplicate & similar product check (excluding self)
  const [exactConflict, setExactConflict] = useState<DuplicateCheckMatch | null>(null);
  const [similarConflicts, setSimilarConflicts] = useState<DuplicateCheckMatch[]>([]);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  useEffect(() => {
    if (!name.trim()) {
      setExactConflict(null);
      setSimilarConflicts([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingDuplicate(true);
      try {
        const queryParams = new URLSearchParams({
          name: name.trim(),
          brand: brand.trim(),
          excludeId: initialData.id,
        });
        const res = await fetch(`/api/v1/catalog/products/check-name?${queryParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setExactConflict(data.exactMatch || null);
          setSimilarConflicts(data.similarMatches || []);
        }
      } catch {
        // Non-blocking background check
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [name, brand, initialData.id]);

  // Tax
  const firstVar = initialData.variants[0];
  const [gstApplicable, setGstApplicable] = useState(firstVar?.taxTreatment !== "NON_GST");
  const [hsnCode, setHsnCode] = useState(initialData.hsnCode || "61091000");
  const [taxRateMode, setTaxRateMode] = useState<"FIXED" | "APPAREL_SLAB">(
    (firstVar?.taxRateMode as "FIXED" | "APPAREL_SLAB") || "APPAREL_SLAB"
  );
  const [taxRateBp, setTaxRateBp] = useState<number>(firstVar?.taxRateBp ?? 500);

  // Variant Rows
  const [variants, setVariants] = useState(
    initialData.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode || "",
      size: v.size || "Free Size",
      colour: v.colour || "Standard",
      costPrice: v.costPriceMinor != null ? (v.costPriceMinor / 100).toFixed(2) : "",
      price: v.priceMinor != null ? (v.priceMinor / 100).toFixed(2) : "",
      mrp: v.mrpMinor != null ? (v.mrpMinor / 100).toFixed(2) : "",
      stockQuantity: v.stockQuantity ?? 0,
      isActive: v.isActive,
    }))
  );

  const [cameraScannerRowIdx, setCameraScannerRowIdx] = useState<number | null>(null);

  // Missing combinations generator
  const sizeDef = attributeDefinitions.find((d) => d.code === "SIZE");
  const colourDef = attributeDefinitions.find((d) => d.code === "COLOUR");
  const [selectedSizeGroupId, setSelectedSizeGroupId] = useState(sizeGroups[0]?.id || "");
  const [newSelectedSizes, setNewSelectedSizes] = useState<string[]>([]);
  const [newSelectedColours, setNewSelectedColours] = useState<string[]>([]);

  function generateMissingCombinations() {
    if (newSelectedSizes.length === 0 || newSelectedColours.length === 0) {
      setError("Pick at least one size and one colour to add new combinations.");
      return;
    }
    setError(null);

    const additions: typeof variants = [];
    const cleanName = (name || "PRD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "PRD";

    newSelectedSizes.forEach((sz) => {
      newSelectedColours.forEach((clr) => {
        const exists = variants.some(
          (v) => v.size.toLowerCase() === sz.toLowerCase() && v.colour.toLowerCase() === clr.toLowerCase()
        );
        if (!exists) {
          const cleanSize = sz.toUpperCase().replace(/[^A-Z0-9]/g, "") || "SZ";
          const cleanClr = clr.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "CLR";
          const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(2, 5);

          const sibling = variants[0];
          additions.push({
            id: "", // Empty ID marks it as NEW variant to be created by updateProduct
            sku: `SKU-${cleanName}-${cleanSize}-${cleanClr}-${rand}`,
            // Left blank: the server creates the next in-store barcode on save.
            barcode: "",
            size: sz,
            colour: clr,
            costPrice: sibling?.costPrice || "",
            price: sibling?.price || "999.00",
            mrp: sibling?.mrp || "1499.00",
            stockQuantity: 0,
            isActive: true,
          });
        }
      });
    });

    if (additions.length === 0) {
      setError("All selected size/colour combinations already exist for this product.");
      return;
    }

    setVariants((prev) => [...prev, ...additions]);
    setNewSelectedSizes([]);
    setNewSelectedColours([]);
  }

  async function handleSave() {
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    // Validation
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!;
      const p = parseFloat(v.price || "0");
      const mrp = parseFloat(v.mrp || "0");

      if (p <= 0) {
        setError(`Row ${i + 1} (${v.size} / ${v.colour}): Selling price must be greater than 0.`);
        setIsSubmitting(false);
        return;
      }
      if (mrp > 0 && p > mrp) {
        setError(`Row ${i + 1} (${v.size} / ${v.colour}): Selling price (₹${p}) cannot exceed MRP (₹${mrp}).`);
        setIsSubmitting(false);
        return;
      }
    }

    const payloadVariants = variants.map((v) => ({
      id: v.id || undefined,
      sku: v.sku.trim(),
      barcode: v.barcode.trim() || null,
      size: v.size.trim(),
      colour: v.colour.trim(),
      costPriceMinor: v.costPrice ? Math.round(parseFloat(v.costPrice) * 100) : null,
      priceMinor: Math.round(parseFloat(v.price) * 100),
      mrpMinor: v.mrp ? Math.round(parseFloat(v.mrp) * 100) : null,
      taxRateBp: gstApplicable ? (taxRateMode === "APPAREL_SLAB" ? 500 : taxRateBp) : 0,
      taxRateMode: gstApplicable ? taxRateMode : "FIXED",
      taxTreatment: gstApplicable ? "TAXABLE" : "NON_GST",
      isActive: v.isActive,
    }));

    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      brand: brand.trim() || null,
      imageUrl: imageUrl.trim() || null,
      isActive,
      baseUomId: baseUomId || null,
      variants: payloadVariants,
    };

    try {
      const res = await fetch(`/api/v1/catalog/products/${initialData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || "Failed to update product.");
      }

      setSuccess(true);
      router.refresh();
      setTimeout(() => {
        router.push(`/products/${initialData.id}`);
      }, 700);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Sticky Save Bar */}
      <div className="sticky top-4 z-20 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-md backdrop-blur-md">
        <div>
          <h1 className="text-base font-bold text-slate-900">Editing: {initialData.name}</h1>
          <p className="text-xs text-slate-500">All changes update master records and prices</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(`/products/${initialData.id}`)}
            className={buttonClass("secondary")}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || !!exactConflict}
            onClick={handleSave}
            className={buttonClass("primary")}
          >
            <Save className="h-4 w-4 mr-1.5" />
            {isSubmitting ? "Saving Changes..." : exactConflict ? "Name Conflict (Cannot Save)" : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 shadow-xs">
          <Check className="h-4 w-4 shrink-0" />
          <span>Product updated successfully! Returning to overview...</span>
        </div>
      )}

      {/* SECTION 1: Master Details */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          1. Product Master Details
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                exactConflict
                  ? "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-red-200"
                  : "border-slate-200 bg-slate-50/50 focus:border-primary focus:bg-white focus:ring-primary/20"
              }`}
              required
            />

            {/* Exact Conflict Blocked Box */}
            {exactConflict && (
              <div className="mt-2.5 rounded-xl border border-red-200 bg-red-50/90 p-4 text-xs shadow-xs amb-pop-in">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-bold text-red-900">
                        &ldquo;{exactConflict.name}&rdquo; {exactConflict.brand ? `(${exactConflict.brand}) ` : ""}already exists
                      </p>
                      <p className="mt-0.5 text-red-700">
                        {exactConflict.stockCount > 0 ? `${exactConflict.stockCount} in stock` : "0 stock"} · {exactConflict.variantCount} variants
                        {!exactConflict.isActive && " · Currently Archived"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/products/${exactConflict.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 font-bold text-white shadow-2xs hover:bg-red-800 transition-colors"
                    >
                      <span>Open it</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Similar Conflict Soft Warning */}
            {!exactConflict && similarConflicts.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs shadow-2xs amb-fade-in">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-900">Similar product found: </span>
                    <span className="text-amber-800">
                      {similarConflicts.map((s) => `"${s.name}"${s.brand ? ` (${s.brand})` : ""}`).join(", ")}
                    </span>
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      You can still save this if it is a distinct article or model.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category</label>
            <input
              type="text"
              list="edit-category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
            />
            <datalist id="edit-category-suggestions">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Brand / Label</label>
            <input
              type="text"
              list="edit-brand-suggestions"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
            />
            <datalist id="edit-brand-suggestions">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Base Unit (UOM)</label>
            <select
              value={baseUomId}
              onChange={(e) => setBaseUomId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
            >
              {uoms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="isActiveToggle"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
            />
            <label htmlFor="isActiveToggle" className="text-xs font-bold text-slate-800">
              Product is active for billing & sales
            </label>
          </div>

          <div className="sm:col-span-2 pt-2">
            <ProductImagePicker
              value={imageUrl || null}
              onChange={(url) => setImageUrl(url || "")}
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      {/* SECTION 2: Tax & Statutory */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          2. Tax & Statutory Treatment
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="gstApplicableEdit"
            checked={gstApplicable}
            onChange={(e) => setGstApplicable(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
          />
          <label htmlFor="gstApplicableEdit" className="text-xs font-bold text-slate-800">
            GST is Applicable to this item
          </label>
        </div>

        {gstApplicable && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Garment Tax Mode</label>
              <select
                value={taxRateMode}
                onChange={(e) => setTaxRateMode(e.target.value as "FIXED" | "APPAREL_SLAB")}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
              >
                <option value="APPAREL_SLAB">{slabLabel}</option>
                <option value="FIXED">FIXED Rate</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Default GST Rate</label>
              <select
                value={taxRateBp}
                disabled={taxRateMode === "APPAREL_SLAB"}
                onChange={(e) => setTaxRateBp(parseInt(e.target.value, 10))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none disabled:opacity-60"
              >
                <option value={500}>5% GST</option>
                <option value={1200}>12% GST</option>
                <option value={1800}>18% GST</option>
                <option value={0}>0% / Exempt</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: Variant Matrix & Pricing */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">3. Variant Matrix & Price Management</h2>
            <p className="text-xs text-slate-500">Edit selling prices, MRP, barcodes, or deactivate variants</p>
          </div>
          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            {variants.length} Variants
          </span>
        </div>

        {/* Matrix Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Colour</th>
                <th className="py-2.5 px-3">SKU</th>
                <th className="py-2.5 px-3 min-w-[200px]">Barcode</th>
                <th className="py-2.5 px-3">Cost (₹)</th>
                <th className="py-2.5 px-3">Selling Price (₹)</th>
                <th className="py-2.5 px-3">MRP (₹)</th>
                <th className="py-2.5 px-3 text-right">Units on Hand</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {variants.map((row, idx) => (
                <tr key={row.id || `new_${idx}`} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2 px-3 font-bold text-slate-900">{row.size}</td>
                  <td className="py-2 px-3 font-medium text-slate-800">{row.colour}</td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={row.sku}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
                        setVariants((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, sku: val } : r))
                        );
                      }}
                      className="w-36 rounded-md border border-slate-200 px-2 py-1 font-mono text-[11px]"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={row.barcode}
                        placeholder="Barcode"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setVariants((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, barcode: val } : r))
                          );
                        }}
                        className="w-28 rounded-md border border-slate-200 px-2 py-1 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        title="Scan Barcode via Camera"
                        onClick={() => setCameraScannerRowIdx(idx)}
                        className="p-1 rounded-md text-slate-400 hover:text-primary hover:bg-slate-100"
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="0.01"
                      value={row.costPrice}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVariants((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, costPrice: val } : r))
                        );
                      }}
                      className="w-18 rounded-md border border-slate-200 px-2 py-1 text-right font-medium"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVariants((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, price: val } : r))
                        );
                      }}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right font-bold text-slate-900"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="0.01"
                      value={row.mrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVariants((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, mrp: val } : r))
                        );
                      }}
                      className="w-18 rounded-md border border-slate-200 px-2 py-1 text-right font-medium"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-slate-700">
                    {row.stockQuantity.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setVariants((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, isActive: !r.isActive } : r))
                        );
                      }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {row.isActive ? "Active" : "Disabled"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Missing Combinations Generator */}
        <div className="rounded-xl border border-sky-100 bg-sky-50/30 p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-950">
            <Plus className="h-4 w-4 text-primary" /> Add Missing Sizes & Colours
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">Pick Sizes</label>
              <div className="flex flex-wrap gap-1.5">
                {sizeDef?.values.map((v) => {
                  const isSel = newSelectedSizes.includes(v.value);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        setNewSelectedSizes((prev) =>
                          isSel ? prev.filter((s) => s !== v.value) : [...prev, v.value]
                        )
                      }
                      className={`h-7 px-2.5 rounded text-xs font-bold transition-all ${
                        isSel ? "bg-sky-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {v.value}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">Pick Colours</label>
              <div className="flex flex-wrap gap-1.5">
                {colourDef?.values.map((c) => {
                  const isSel = newSelectedColours.includes(c.value);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setNewSelectedColours((prev) =>
                          isSel ? prev.filter((col) => col !== c.value) : [...prev, c.value]
                        )
                      }
                      className={`h-7 px-2.5 rounded text-xs font-bold transition-all ${
                        isSel ? "bg-sky-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {c.value}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={generateMissingCombinations}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-800 transition-colors shadow-2xs"
            >
              Generate Missing Variants
            </button>
          </div>
        </div>
      </div>

      {/* Barcode Camera Modal for Table Row */}
      {cameraScannerRowIdx !== null && (
        <CameraBarcodeScannerModal
          isOpen={cameraScannerRowIdx !== null}
          onClose={() => setCameraScannerRowIdx(null)}
          onScan={(scanned) => {
            setVariants((prev) =>
              prev.map((r, i) => (i === cameraScannerRowIdx ? { ...r, barcode: scanned } : r))
            );
            setCameraScannerRowIdx(null);
          }}
        />
      )}
    </div>
  );
}
