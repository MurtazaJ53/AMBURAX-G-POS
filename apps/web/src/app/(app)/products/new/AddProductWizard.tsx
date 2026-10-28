"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Layers,
  Percent,
  Barcode,
  Building2,
  Tag,
  AlertCircle,
  Plus,
  Trash2,
  Camera,
  Printer,
  Package,
  RotateCcw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";
import { ProductImagePicker } from "../_components/ProductImagePicker";
import { BarcodeLabelModal, type PrintableVariantItem } from "../[id]/BarcodeLabelModal";
import { useFormDraft } from "@/client/hooks/useFormDraft";
import type { DuplicateCheckMatch } from "@/app/api/v1/catalog/products/check-name/route";

interface StoreOption {
  id: string;
  name: string;
  code: string;
  storeType: string;
  isDefault: boolean;
}

interface AttributeValueOption {
  id: string;
  value: string;
  code: string;
  colorHex: string | null;
  sortOrder: number;
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

interface AddProductWizardProps {
  uoms: Array<{ id: string; name: string; code: string }>;
  stores: StoreOption[];
  attributeDefinitions: AttributeDefOption[];
  sizeGroups: SizeGroupOption[];
  categories?: string[];
  brands?: string[];
}

  export interface VariantGridRow {
  key: string;
  size: string;
  colour: string;
  colorHex: string | null;
  sku: string;
  barcode: string;
  costPrice: string;
  mrp: string;
  retailPrice: string;
  wholesalePrice: string;
  minPrice: string;
  openingStock: Record<string, string>; // storeId -> quantity
  isActive: boolean;
}

const WIZARD_STEPS = [
  { id: 1, title: "Basic Details", desc: "Product name, category & brand" },
  { id: 2, title: "Tax & GST", desc: "HSN, GST rate & tax type" },
  { id: 3, title: "Size & Colours", desc: "Pick size groups & color swatches" },
  { id: 4, title: "Variants & Stock", desc: "Pricing, margins & store opening stock" },
  { id: 5, title: "Wholesale & Review", desc: "Packaging, packs & barcode generation" },
];

export function AddProductWizard({
  uoms,
  stores,
  attributeDefinitions,
  sizeGroups,
  categories = [],
  brands = [],
}: AddProductWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Automatic Offline & Refresh Draft Persistence
  const [wizardDraft, setWizardDraft, resetWizardDraft, hasRestoredDraft] = useFormDraft("gpos_product_wizard_draft", {
    name: "",
    category: "",
    brand: "",
    baseUomId: uoms[0]?.id || "",
    imageUrl: "",
    gstApplicable: true,
    hsnCode: "61091000",
    taxRateBp: 500,
    taxRateMode: "APPAREL_SLAB" as "FIXED" | "APPAREL_SLAB",
    taxInclusive: false,
    selectedSizeGroupId: sizeGroups[0]?.id || "",
    selectedSizes: sizeGroups[0]?.sizes.map((s) => s.name) || [],
    selectedColours: [
      { name: "Black", hex: "#000000" },
      { name: "White", hex: "#FFFFFF" },
      { name: "Navy", hex: "#000080" },
    ] as Array<{ name: string; hex: string | null }>,
    tableRows: [] as VariantGridRow[],
    packSize: "1",
    minOrderQty: "1",
  });

  // --- Step 1: Basics ---
  const name = wizardDraft.name;
  const setName = (val: string) => setWizardDraft((p) => ({ ...p, name: val }));

  const category = wizardDraft.category;
  const setCategory = (val: string) => setWizardDraft((p) => ({ ...p, category: val }));

  const brand = wizardDraft.brand;
  const setBrand = (val: string) => setWizardDraft((p) => ({ ...p, brand: val }));

  const baseUomId = wizardDraft.baseUomId;
  const setBaseUomId = (val: string) => setWizardDraft((p) => ({ ...p, baseUomId: val }));

  const imageUrl = wizardDraft.imageUrl;
  const setImageUrl = (val: string) => setWizardDraft((p) => ({ ...p, imageUrl: val }));

  // --- Step 2: Tax & GST ---
  const gstApplicable = wizardDraft.gstApplicable;
  const setGstApplicable = (val: boolean) => setWizardDraft((p) => ({ ...p, gstApplicable: val }));

  const hsnCode = wizardDraft.hsnCode;
  const setHsnCode = (val: string) => setWizardDraft((p) => ({ ...p, hsnCode: val }));

  const taxRateBp = wizardDraft.taxRateBp;
  const setTaxRateBp = (val: number) => setWizardDraft((p) => ({ ...p, taxRateBp: val }));

  const taxRateMode = wizardDraft.taxRateMode;
  const setTaxRateMode = (val: "FIXED" | "APPAREL_SLAB") => setWizardDraft((p) => ({ ...p, taxRateMode: val }));

  const taxInclusive = wizardDraft.taxInclusive;
  const setTaxInclusive = (val: boolean) => setWizardDraft((p) => ({ ...p, taxInclusive: val }));

  // --- Step 3: Variant Generator ---
  const sizeDef = useMemo(() => attributeDefinitions.find((d) => d.code === "SIZE"), [attributeDefinitions]);
  const colourDef = useMemo(() => attributeDefinitions.find((d) => d.code === "COLOUR"), [attributeDefinitions]);

  const selectedSizeGroupId = wizardDraft.selectedSizeGroupId;
  const setSelectedSizeGroupId = (val: string) => setWizardDraft((p) => ({ ...p, selectedSizeGroupId: val }));

  const selectedSizes = wizardDraft.selectedSizes;
  const setSelectedSizes = (val: string[] | ((prev: string[]) => string[])) =>
    setWizardDraft((p) => ({
      ...p,
      selectedSizes: typeof val === "function" ? val(p.selectedSizes) : val,
    }));

  const selectedColours = wizardDraft.selectedColours;
  const setSelectedColours = (
    val:
      | Array<{ name: string; hex: string | null }>
      | ((prev: Array<{ name: string; hex: string | null }>) => Array<{ name: string; hex: string | null }>)
  ) =>
    setWizardDraft((p) => ({
      ...p,
      selectedColours: typeof val === "function" ? val(p.selectedColours) : val,
    }));

  // --- Step 4: Variant Matrix Grid ---
  const tableRows = wizardDraft.tableRows;
  const setTableRows = (val: VariantGridRow[] | ((prev: VariantGridRow[]) => VariantGridRow[])) =>
    setWizardDraft((p) => ({
      ...p,
      tableRows: typeof val === "function" ? val(p.tableRows) : val,
    }));

  const [cameraScannerRowIdx, setCameraScannerRowIdx] = useState<number | null>(null);

  // Bulk fill inputs
  const [bulkCost, setBulkCost] = useState("");
  const [bulkMrp, setBulkMrp] = useState("");
  const [bulkRetailPrice, setBulkRetailPrice] = useState("");
  const [bulkWholesalePrice, setBulkWholesalePrice] = useState("");
  const [bulkMinPrice, setBulkMinPrice] = useState("");
  const [bulkOpeningQty, setBulkOpeningQty] = useState("");
  const [bulkStoreId, setBulkStoreId] = useState(stores[0]?.id || "");

  // --- Step 5: Wholesale Tiers ---
  const packSize = wizardDraft.packSize;
  const setPackSize = (val: string) => setWizardDraft((p) => ({ ...p, packSize: val }));

  const minOrderQty = wizardDraft.minOrderQty;
  const setMinOrderQty = (val: string) => setWizardDraft((p) => ({ ...p, minOrderQty: val }));

  // Post-save label printing modal state
  const [createdLabelVariants, setCreatedLabelVariants] = useState<PrintableVariantItem[] | null>(null);
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);

  // Debounced duplicate & similar product check
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
  }, [name, brand]);

  // Regenerate / populate matrix whenever Step 3 selections change or user advances to Step 4
  function syncMatrixRows() {
    const sizesToUse = selectedSizes.length > 0 ? selectedSizes : ["Free Size"];
    const coloursToUse = selectedColours.length > 0 ? selectedColours : [{ name: "Standard", hex: null }];

    const newRows: VariantGridRow[] = [];
    sizesToUse.forEach((sz) => {
      coloursToUse.forEach((clr) => {
        const key = `${sz}__${clr.name}`;
        // Preserve row data if it already exists
        const existing = tableRows.find((r) => r.key === key);
        if (existing) {
          newRows.push(existing);
        } else {
          const cleanName = (name || "PRD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "PRD";
          const cleanSize = sz.toUpperCase().replace(/[^A-Z0-9]/g, "") || "SZ";
          const cleanClr = clr.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "CLR";
          const randomSuffix = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(2, 5);
          const skuCode = `SKU-${cleanName}-${cleanSize}-${cleanClr}-${randomSuffix}`;
          newRows.push({
            key,
            size: sz,
            colour: clr.name,
            colorHex: clr.hex,
            sku: skuCode,
            barcode: "",
            costPrice: bulkCost || "",
            mrp: bulkMrp || "",
            retailPrice: bulkRetailPrice || "",
            wholesalePrice: bulkWholesalePrice || "",
            minPrice: "",
            openingStock: bulkOpeningQty && bulkStoreId ? { [bulkStoreId]: bulkOpeningQty } : {},
            isActive: true,
          });
        }
      });
    });

    setTableRows(newRows);
  }

  // Handle Size Group selection
  function handleSelectSizeGroup(groupId: string) {
    setSelectedSizeGroupId(groupId);
    const grp = sizeGroups.find((g) => g.id === groupId);
    if (grp) {
      setSelectedSizes(grp.sizes.map((s) => s.name));
    }
  }

  // Toggle individual size
  function toggleSize(sizeName: string) {
    setSelectedSizes((prev) =>
      prev.includes(sizeName) ? prev.filter((s) => s !== sizeName) : [...prev, sizeName]
    );
  }

  // Toggle individual colour
  function toggleColour(clr: { name: string; hex: string | null }) {
    setSelectedColours((prev) => {
      const exists = prev.some((c) => c.name.toLowerCase() === clr.name.toLowerCase());
      if (exists) {
        return prev.filter((c) => c.name.toLowerCase() !== clr.name.toLowerCase());
      }
      return [...prev, clr];
    });
  }

  // Apply bulk fill to all rows
  function applyBulkFill() {
    setTableRows((prev) =>
      prev.map((r) => {
        const updated = { ...r };
        if (bulkCost.trim()) updated.costPrice = bulkCost.trim();
        if (bulkMrp.trim()) updated.mrp = bulkMrp.trim();
        if (bulkRetailPrice.trim()) updated.retailPrice = bulkRetailPrice.trim();
        if (bulkWholesalePrice.trim()) updated.wholesalePrice = bulkWholesalePrice.trim();
        if (bulkMinPrice.trim()) updated.minPrice = bulkMinPrice.trim();
        if (bulkOpeningQty.trim() && bulkStoreId) {
          updated.openingStock = {
            ...updated.openingStock,
            [bulkStoreId]: bulkOpeningQty.trim(),
          };
        }
        return updated;
      })
    );
  }

  // Step 4 Validation before moving to Step 5
  function validateStep4(): boolean {
    for (let i = 0; i < tableRows.length; i++) {
      const r = tableRows[i]!;
      const rPrice = parseFloat(r.retailPrice || "0");
      const rMrp = parseFloat(r.mrp || "0");
      const rMinPrice = parseFloat(r.minPrice || "0");
      const rCost = parseFloat(r.costPrice || "0");

      // Check opening stock
      const totalOpeningQty = Object.values(r.openingStock).reduce((sum, q) => sum + (parseInt(q, 10) || 0), 0);
      if (totalOpeningQty > 0 && (!rCost || rCost <= 0)) {
        setError(`Row ${i + 1} (${r.size} / ${r.colour}): Cost Price is required when opening stock (${totalOpeningQty} units) is entered.`);
        return false;
      }

      if (rPrice <= 0) {
        setError(`Row ${i + 1} (${r.size} / ${r.colour}): Retail Price must be greater than 0.`);
        return false;
      }
      if (rMrp > 0 && rPrice > rMrp) {
        setError(`Row ${i + 1} (${r.size} / ${r.colour}): Retail Price (₹${rPrice}) cannot exceed MRP (₹${rMrp}).`);
        return false;
      }
      if (rMinPrice > 0 && rPrice < rMinPrice) {
        setError(`Row ${i + 1} (${r.size} / ${r.colour}): Retail Price (₹${rPrice}) cannot be below Minimum Price (₹${rMinPrice}).`);
        return false;
      }
    }
    setError(null);
    return true;
  }

  // Submit wizard to /api/v1/catalog/products
  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    const payloadVariants = tableRows.map((r) => {
      const costMinor = r.costPrice ? Math.round(parseFloat(r.costPrice) * 100) : null;
      const mrpMinor = r.mrp ? Math.round(parseFloat(r.mrp) * 100) : null;
      const priceMinor = Math.round(parseFloat(r.retailPrice) * 100);
      const minPriceMinor = r.minPrice ? Math.round(parseFloat(r.minPrice) * 100) : null;

      const openingStockArr = Object.entries(r.openingStock)
        .filter(([_, qty]) => parseInt(qty, 10) > 0)
        .map(([sId, qty]) => ({
          storeId: sId,
          quantity: parseInt(qty, 10),
        }));

      return {
        sku: r.sku.trim(),
        barcode: r.barcode.trim() ? r.barcode.trim() : null,
        size: r.size,
        colour: r.colour,
        costPriceMinor: costMinor,
        mrpMinor: mrpMinor,
        priceMinor: priceMinor,
        minPriceMinor,
        taxRateBp: gstApplicable ? (taxRateMode === "APPAREL_SLAB" ? 500 : taxRateBp) : 0,
        taxRateMode: gstApplicable ? taxRateMode : "FIXED",
        taxTreatment: gstApplicable ? "TAXABLE" : "NON_GST",
        openingStock: openingStockArr,
        isActive: r.isActive,
      };
    });

    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      brand: brand.trim() || null,
      imageUrl: imageUrl.trim() || null,
      hsnCode: gstApplicable && hsnCode.trim() ? hsnCode.trim() : null,
      baseUomId,
      isActive: true,
      variants: payloadVariants,
    };

    try {
      const res = await fetch("/api/v1/catalog/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg =
          typeof data?.error === "object"
            ? data.error.message || JSON.stringify(data.error)
            : data?.error || data?.message || "Failed to create product.";
        throw new Error(errorMsg);
      }

      // Reset offline draft upon successful save
      resetWizardDraft();

      // If server returned created variants with their generated barcodes, prepare printable labels
      if (Array.isArray(data.variants) && data.variants.length > 0) {
        const labelItems: PrintableVariantItem[] = data.variants.map((v: { id: string; sku: string; barcode: string | null }, idx: number) => {
          const row = tableRows[idx] || tableRows[0];
          const totalQty = row ? Object.values(row.openingStock).reduce((acc, q) => acc + (parseInt(q, 10) || 0), 0) : 1;
          return {
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            productName: name.trim(),
            size: row?.size || null,
            colour: row?.colour || null,
            priceMinor: row ? Math.round(parseFloat(row.retailPrice || "0") * 100) : 0,
            mrpMinor: row?.mrp ? Math.round(parseFloat(row.mrp) * 100) : null,
            quantity: totalQty > 0 ? totalQty : 1,
          };
        });
        setCreatedProductId(data.productId);
        setCreatedLabelVariants(labelItems);
        setIsSubmitting(false);
      } else {
        router.push(`/products/${data.productId}`);
        router.refresh();
      }
    } catch (err: unknown) {
      setError((err as Error).message);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Wizard Header & Progress Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Add Garment Product Wizard</h1>
            <p className="text-xs text-slate-500 mt-1">Multi-variant matrix generator with live margin & multi-store opening stock</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Step {currentStep} of {WIZARD_STEPS.length}
          </span>
        </div>

        {/* Step Indicator Badges */}
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {WIZARD_STEPS.map((s) => {
            const isDone = s.id < currentStep;
            const isCurrent = s.id === currentStep;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (s.id < currentStep) setCurrentStep(s.id);
                  if (s.id === 4 && currentStep === 3) {
                    syncMatrixRows();
                    setCurrentStep(4);
                  }
                }}
                className={`flex items-center gap-2 rounded-xl p-2.5 text-left transition-all ${
                  isCurrent
                    ? "bg-primary text-white shadow-sm ring-2 ring-primary/30"
                    : isDone
                    ? "bg-sky-50 text-sky-800 hover:bg-sky-100"
                    : "bg-slate-50 text-slate-400"
                }`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isCurrent
                      ? "bg-white text-primary"
                      : isDone
                      ? "bg-primary text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> : s.id}
                </div>
                <div className="truncate">
                  <div className="text-xs font-bold leading-tight truncate">{s.title}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Offline / Refresh Recovery Banner */}
      {hasRestoredDraft && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-xs text-sky-900 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-[10px]">
              ✓
            </span>
            <span>
              <b>Draft restored!</b> Your entered product details, variants, and pricing were preserved across refresh.
            </span>
          </div>
          <button
            type="button"
            onClick={resetWizardDraft}
            className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-800 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Clear Draft</span>
          </button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* STEP 1: Basic Details */}
      {currentStep === 1 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">1. Product Essentials</h2>
            <p className="text-xs text-slate-500">Configure canonical master details for this style.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Slim Fit Denim Cotton Shirt"
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
                      <a
                        href={`/products/${exactConflict.id}/edit`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-bold text-red-800 hover:bg-red-50 transition-colors"
                      >
                        <span>Add variant</span>
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
                list="category-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Shirts, Kurtas, T-Shirts"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <datalist id="category-suggestions">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Brand / Label</label>
              <input
                type="text"
                list="brand-suggestions"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Amburax Signature"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <datalist id="brand-suggestions">
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 pt-2">
              <ProductImagePicker
                value={imageUrl || null}
                onChange={(url) => setImageUrl(url || "")}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              type="button"
              disabled={!name.trim() || Boolean(exactConflict)}
              onClick={() => {
                if (!name.trim()) {
                  setError("Product name is required.");
                  return;
                }
                if (exactConflict) {
                  setError(`"${exactConflict.name}" already exists. Change the name or brand to proceed.`);
                  return;
                }
                setError(null);
                setCurrentStep(2);
              }}
              className={buttonClass("primary")}
            >
              Next: Tax & GST <ChevronRight className="h-4 w-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Tax & GST */}
      {currentStep === 2 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">2. Tax & Statutory Treatment</h2>
            <p className="text-xs text-slate-500">Configure Indian GST rules, Garment Slab, and HSN code.</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="gstApplicable"
                checked={gstApplicable}
                onChange={(e) => setGstApplicable(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
              />
              <label htmlFor="gstApplicable" className="text-xs font-bold text-slate-800">
                GST is Applicable to this item
              </label>
            </div>

            {gstApplicable && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">HSN Code</label>
                  <input
                    type="text"
                    value={hsnCode}
                    onChange={(e) => setHsnCode(e.target.value)}
                    placeholder="e.g. 61091000"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Garment Tax Mode</label>
                  <select
                    value={taxRateMode}
                    onChange={(e) => setTaxRateMode(e.target.value as "FIXED" | "APPAREL_SLAB")}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                  >
                    <option value="APPAREL_SLAB">APPAREL_SLAB (5% up to ₹2500, 18% above)</option>
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

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Price Inclusivity</label>
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="taxInclusive"
                      checked={taxInclusive}
                      onChange={(e) => setTaxInclusive(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
                    />
                    <label htmlFor="taxInclusive" className="text-xs font-medium text-slate-700">
                      Prices are Tax Inclusive (MRP/Retail include GST)
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setCurrentStep(1)} className={buttonClass("secondary")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setCurrentStep(3);
              }}
              className={buttonClass("primary")}
            >
              Next: Size & Colours <ChevronRight className="h-4 w-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Size & Colour Pickers from Tenant Masters */}
      {currentStep === 3 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">3. Size Groups & Color Swatches</h2>
            <p className="text-xs text-slate-500">
              Pick from tenant master templates or customize sizes and colors for this article.
            </p>
          </div>

          {/* Size Group Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Choose Pre-Configured Size Group
            </label>
            <div className="flex flex-wrap gap-2">
              {sizeGroups.map((g) => {
                const isSelected = selectedSizeGroupId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleSelectSizeGroup(g.id)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-primary text-white shadow-xs"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Individual Size Toggle Buttons */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Sizes ({selectedSizes.length} selected)
            </label>
            <div className="flex flex-wrap gap-2">
              {sizeDef?.values.map((v) => {
                const isSelected = selectedSizes.includes(v.value);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleSize(v.value)}
                    className={`h-9 min-w-[40px] rounded-lg px-3 text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-sky-900 text-white shadow-xs"
                        : "border border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {v.value}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colour Swatch Picker */}
          <div className="space-y-3 pt-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Pick Colour Swatches ({selectedColours.length} selected)
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {colourDef?.values.map((c) => {
                const isSelected = selectedColours.some((sc) => sc.name.toLowerCase() === c.value.toLowerCase());
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleColour({ name: c.value, hex: c.colorHex })}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-sky-50/60 ring-2 ring-primary/20 shadow-2xs"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-slate-300 shadow-2xs"
                      style={{ backgroundColor: c.colorHex || "#CBD5E1" }}
                    />
                    <span className="text-xs font-semibold text-slate-800 truncate">{c.value}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setCurrentStep(2)} className={buttonClass("secondary")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                syncMatrixRows();
                setCurrentStep(4);
              }}
              className={buttonClass("primary")}
            >
              Generate Variant Grid ({selectedSizes.length * selectedColours.length} rows){" "}
              <ChevronRight className="h-4 w-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Variant Matrix Grid with Bulk Fill & Live Margins */}
      {currentStep === 4 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">4. Variant Matrix & Opening Stock</h2>
              <p className="text-xs text-slate-500">
                Specify retail price, MRP, cost price, and assign opening balances per location.
              </p>
            </div>
            <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md self-start">
              {tableRows.length} Variants
            </span>
          </div>

          {/* Bulk Fill Toolbar */}
          <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900">
              <Sparkles className="h-4 w-4 text-primary" /> Bulk Fill Prices & Stock
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-7">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Cost (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bulkCost}
                  onChange={(e) => setBulkCost(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bulkMrp}
                  onChange={(e) => setBulkMrp(e.target.value)}
                  placeholder="e.g. 1499"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Retail Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bulkRetailPrice}
                  onChange={(e) => setBulkRetailPrice(e.target.value)}
                  placeholder="e.g. 1199"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Wholesale (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bulkWholesalePrice}
                  onChange={(e) => setBulkWholesalePrice(e.target.value)}
                  placeholder="e.g. 850"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Min Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bulkMinPrice}
                  onChange={(e) => setBulkMinPrice(e.target.value)}
                  placeholder="e.g. 799"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Store</label>
                <select
                  value={bulkStoreId}
                  onChange={(e) => setBulkStoreId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Qty</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={bulkOpeningQty}
                    onChange={(e) => setBulkOpeningQty(e.target.value)}
                    placeholder="10"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={applyBulkFill}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-800 shrink-0 shadow-2xs"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stock Value Live Preview Banner in Indian Currency Format */}
          {(() => {
            const totalUnits = tableRows.reduce((acc, r) => {
              return acc + Object.values(r.openingStock).reduce((sum, q) => sum + (parseInt(q, 10) || 0), 0);
            }, 0);
            const totalStockValue = tableRows.reduce((acc, r) => {
              const cost = parseFloat(r.costPrice || "0");
              const qty = Object.values(r.openingStock).reduce((sum, q) => sum + (parseInt(q, 10) || 0), 0);
              return acc + (cost * qty);
            }, 0);

            if (totalUnits === 0) return null;

            return (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs">
                    ₹
                  </span>
                  <div>
                    <span className="font-semibold text-emerald-950">Opening Stock Summary: </span>
                    <span className="text-emerald-800 font-bold">{totalUnits} units</span> across variants
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 text-[11px] uppercase tracking-wider font-semibold">Total Stock Valuation: </span>
                  <span className="font-black text-emerald-900 text-sm ml-1">
                    {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(totalStockValue)}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Matrix Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Colour</th>
                  <th className="py-2.5 px-3">SKU</th>
                  <th className="py-2.5 px-3 min-w-[200px]">
                    <div className="flex items-center justify-between gap-1.5">
                      <span>Barcode</span>
                      <span className="text-[10px] font-normal text-slate-500" title="Leave blank and a barcode is created when you save">
                        blank = auto
                      </span>
                    </div>
                  </th>
                  <th className="py-2.5 px-3">Cost (₹)</th>
                  <th className="py-2.5 px-3">MRP (₹)</th>
                  <th className="py-2.5 px-3">Retail Price (₹)</th>
                  <th className="py-2.5 px-3">Wholesale (₹)</th>
                  <th className="py-2.5 px-3">Min Price (₹)</th>
                  <th className="py-2.5 px-3">Margin %</th>
                  <th className="py-2.5 px-3">Store Opening Qty</th>
                  <th className="py-2.5 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {tableRows.map((row, idx) => {
                  const costNum = parseFloat(row.costPrice || "0");
                  const priceNum = parseFloat(row.retailPrice || "0");
                  const marginPercent =
                    priceNum > 0 && costNum > 0
                      ? Math.round(((priceNum - costNum) / priceNum) * 100)
                      : null;

                  return (
                    <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2 px-3 font-bold text-slate-900">{row.size}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: row.colorHex || "#CBD5E1" }}
                          />
                          <span className="font-medium text-slate-800">{row.colour}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={row.sku}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTableRows((prev) =>
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
                            placeholder="Scan, type or leave blank"
                            onChange={(e) => {
                              const val = e.target.value;
                              setTableRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, barcode: val } : r))
                              );
                            }}
                            className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] placeholder:text-slate-400 focus:border-primary focus:outline-none"
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
                            setTableRows((prev) =>
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
                          value={row.mrp}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTableRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, mrp: val } : r))
                            );
                          }}
                          className="w-18 rounded-md border border-slate-200 px-2 py-1 text-right font-medium"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          value={row.retailPrice}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTableRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, retailPrice: val } : r))
                            );
                          }}
                          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right font-bold text-slate-900"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          value={row.wholesalePrice}
                          placeholder="Opt"
                          onChange={(e) => {
                            const val = e.target.value;
                            setTableRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, wholesalePrice: val } : r))
                            );
                          }}
                          className="w-18 rounded-md border border-slate-200 px-2 py-1 text-right font-medium text-slate-800"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          value={row.minPrice}
                          placeholder="Opt"
                          onChange={(e) => {
                            const val = e.target.value;
                            setTableRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, minPrice: val } : r))
                            );
                          }}
                          className="w-18 rounded-md border border-slate-200 px-2 py-1 text-right font-medium text-slate-800"
                        />
                      </td>
                      <td className="py-2 px-3">
                        {marginPercent !== null ? (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              marginPercent >= 30
                                ? "bg-emerald-50 text-emerald-700"
                                : marginPercent > 0
                                ? "bg-amber-50 text-amber-700"
                                : "bg-red-50 text-red-700"
                            }`}
                          >
                            {marginPercent}%
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={Object.keys(row.openingStock)[0] || stores[0]?.id || ""}
                            onChange={(e) => {
                              const sId = e.target.value;
                              const currentVal = Object.values(row.openingStock)[0] || "";
                              setTableRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, openingStock: { [sId]: currentVal } } : r
                                )
                              );
                            }}
                            className="rounded border border-slate-200 px-1 py-1 text-[11px]"
                          >
                            {stores.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.code}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={Object.values(row.openingStock)[0] || ""}
                            onChange={(e) => {
                              const sId = Object.keys(row.openingStock)[0] || stores[0]?.id || "";
                              const val = e.target.value;
                              setTableRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, openingStock: { [sId]: val } } : r
                                )
                              );
                            }}
                            className="w-14 rounded border border-slate-200 px-1 py-1 text-right text-[11px]"
                          />
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => setTableRows((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-slate-400 hover:text-red-500 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setCurrentStep(3)} className={buttonClass("secondary")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateStep4()) {
                  setCurrentStep(5);
                }
              }}
              className={buttonClass("primary")}
            >
              Next: Wholesale & Review <ChevronRight className="h-4 w-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Wholesale & Final Review */}
      {currentStep === 5 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">5. Wholesale Packaging & Final Review</h2>
            <p className="text-xs text-slate-500">
              Confirm pack rules and review product summary before creating.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Pack Size (Pieces per polybag / box)
              </label>
              <input
                type="number"
                min="1"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Minimum Order Quantity (MOQ)
              </label>
              <input
                type="number"
                min="1"
                value={minOrderQty}
                onChange={(e) => setMinOrderQty(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Summary Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
            <div className="text-xs font-bold text-slate-900">Summary Review</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
              <div>
                <span className="text-slate-400">Product:</span> {name}
              </div>
              <div>
                <span className="text-slate-400">Category:</span> {category || "—"}
              </div>
              <div>
                <span className="text-slate-400">GST Mode:</span> {gstApplicable ? taxRateMode : "Non-GST"}
              </div>
              <div>
                <span className="text-slate-400">Variants:</span> {tableRows.length} total
              </div>
            </div>
          </div>

          {/* A refused save is reported here, beside the button that was pressed: the top-of-page
              alert is scrolled out of sight on this long step. */}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setCurrentStep(4)} className={buttonClass("secondary")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to Matrix
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className={buttonClass("primary")}
            >
              {isSubmitting ? "Creating Variants & Barcodes..." : "Save Product & Generate Barcodes"}
            </button>
          </div>
        </div>
      )}

      {/* Barcode Camera Modal for Table Row */}
      {cameraScannerRowIdx !== null && (
        <CameraBarcodeScannerModal
          isOpen={cameraScannerRowIdx !== null}
          onClose={() => setCameraScannerRowIdx(null)}
          onScan={(scanned) => {
            setTableRows((prev) =>
              prev.map((r, i) => (i === cameraScannerRowIdx ? { ...r, barcode: scanned } : r))
            );
            setCameraScannerRowIdx(null);
          }}
        />
      )}

      {/* Post-Save Thermal Label Printing Modal */}
      {createdLabelVariants && createdProductId && (
        <BarcodeLabelModal
          isOpen={true}
          title="Product Created Successfully! Print Barcode Labels"
          variants={createdLabelVariants}
          onClose={() => {
            router.push(`/products/${createdProductId}`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
