"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PackagePlus, Search, Sparkles, TrendingUp, Camera, ScanLine, Printer, Plus, Trash2, AlertCircle } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { buttonClass } from "../_components/ui";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";
import { BarcodeLabelModal, type PrintableVariantItem } from "../products/[id]/BarcodeLabelModal";
import { ProductImagePicker } from "../products/_components/ProductImagePicker";
import type { PurchaseProductHit, PurchaseVariantHit } from "@/server/purchasing/purchaseItems";

/**
 * Find what arrived the way a shopkeeper thinks: type the product name (or scan a barcode), open
 * it, and fill in how many of each size/colour came. Last cost and GST fill themselves on the bill.
 * Not in the catalogue? "New product" adds it with all its sizes right here (owner).
 */

export type PickedLine = { variant: PurchaseVariantHit; productName: string; quantity: number };

const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

const GST_CHOICES = [
  { key: "NON", label: "Non-GST", treatment: "NON_GST", rateMode: "FIXED", rateBp: 0 },
  { key: "SLAB", label: "Apparel slab (5% <= ₹1,000 / ₹2,500, 12%/18% above)", treatment: "TAXABLE", rateMode: "APPAREL_SLAB", rateBp: 0 },
  { key: "5", label: "Taxable – 5%", treatment: "TAXABLE", rateMode: "FIXED", rateBp: 500 },
  { key: "12", label: "Taxable – 12%", treatment: "TAXABLE", rateMode: "FIXED", rateBp: 1200 },
  { key: "18", label: "Taxable – 18%", treatment: "TAXABLE", rateMode: "FIXED", rateBp: 1800 },
  { key: "28", label: "Taxable – 28%", treatment: "TAXABLE", rateMode: "FIXED", rateBp: 2800 },
  { key: "NIL", label: "Nil-rated", treatment: "NIL_RATED", rateMode: "FIXED", rateBp: 0 },
] as const;

function variantLabel(v: PurchaseVariantHit): string {
  return [v.size, v.colour].filter(Boolean).join(" · ") || "Standard";
}

function SizeGrid({
  product: initialProduct,
  onAdd,
  onClose,
}: {
  product: PurchaseProductHit;
  onAdd: (lines: PickedLine[]) => void;
  onClose: () => void;
}) {
  const [product, setProduct] = useState<PurchaseProductHit>(initialProduct);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [addingVariant, setAddingVariant] = useState(false);
  const [newSizes, setNewSizes] = useState<string[]>([]);
  const [newColour, setNewColour] = useState("");
  const [costInput, setCostInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [mrpInput, setMrpInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);

  // Pre-fill pricing from sibling variant
  const sibling = product.variants[0];
  useEffect(() => {
    if (sibling) {
      if (sibling.costPriceMinor != null || sibling.lastCostMinor != null) {
        setCostInput(String(((sibling.costPriceMinor ?? sibling.lastCostMinor ?? 0) / 100).toFixed(2)));
      }
      setPriceInput(String((sibling.priceMinor / 100).toFixed(2)));
      if (sibling.mrpMinor != null) {
        setMrpInput(String((sibling.mrpMinor / 100).toFixed(2)));
      }
    }
  }, [sibling]);

  const total = Object.values(qty).reduce((s, q) => s + (Number(q) > 0 ? Math.floor(Number(q)) : 0), 0);

  function add() {
    const lines = product.variants
      .map((v) => ({ variant: v, productName: product.name, quantity: Math.floor(Number(qty[v.variantId] ?? 0)) }))
      .filter((l) => l.quantity > 0);
    if (lines.length) onAdd(lines);
  }

  const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "FREE SIZE"];
  const STANDARD_COLOURS = [
    { name: "Black", hex: "#111827" },
    { name: "White", hex: "#FFFFFF" },
    { name: "Navy", hex: "#1E3A8A" },
    { name: "Blue", hex: "#2563EB" },
    { name: "Sky Blue", hex: "#38BDF8" },
    { name: "Olive", hex: "#808000" },
    { name: "Green", hex: "#16A34A" },
    { name: "Red", hex: "#DC2626" },
    { name: "Maroon", hex: "#800000" },
    { name: "Wine", hex: "#722F37" },
    { name: "Grey", hex: "#6B7280" },
    { name: "Dark Grey", hex: "#374151" },
    { name: "Beige", hex: "#D4B996" },
    { name: "Yellow", hex: "#EAB308" },
  ];

  async function handleCreateNewVariant() {
    if (newSizes.length === 0) {
      setAddError("Choose or enter at least one size.");
      return;
    }
    const priceNum = Math.round(Number(priceInput.replaceAll(",", "")) * 100);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setAddError("Enter a valid selling price.");
      return;
    }
    const mrpNum = mrpInput.trim() ? Math.round(Number(mrpInput.replaceAll(",", "")) * 100) : null;
    if (mrpNum !== null && priceNum > mrpNum) {
      setAddError("Selling price cannot exceed MRP.");
      return;
    }
    const costNum = costInput.trim() ? Math.round(Number(costInput.replaceAll(",", "")) * 100) : null;

    setIsSubmitting(true);
    setAddError(null);

    try {
      const res = await fetch(`/api/v1/products/${product.productId}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sizes: newSizes,
          colour: newColour.trim() || null,
          costPriceMinor: costNum,
          priceMinor: priceNum,
          mrpMinor: mrpNum,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data?.error?.message ?? "Failed to create variant. Try again.");
        return;
      }

      const created: PurchaseVariantHit[] = data.variants || [];
      if (created.length > 0) {
        // Append newly created variants into this product's variant list!
        setProduct((prev) => ({
          ...prev,
          variants: [...prev.variants, ...created],
        }));

        // Set default quantity 1 for the newly created variants so shopkeeper can immediately receive them
        setQty((prev) => {
          const next = { ...prev };
          for (const cv of created) {
            next[cv.variantId] = "1";
          }
          return next;
        });

        // Reset sub-form
        setAddingVariant(false);
        setNewSizes([]);
        setNewColour("");
      }
    } catch {
      setAddError("Network error. Could not create variant.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="amb-fade-in rounded-2xl border border-sky-200 bg-sky-50/50 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-sky-100 pb-3">
        <div className="flex items-center gap-3">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-12 w-12 rounded-xl object-cover border border-sky-200/80 shadow-2xs shrink-0"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100/70 text-sky-700 text-xs font-bold shrink-0">
              {product.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-base font-bold text-slate-900">
              {product.name}
              {product.brand ? <span className="font-medium text-slate-500"> · {product.brand}</span> : null}
            </p>
            <p className="text-xs text-slate-600">Enter received quantities for existing sizes or add a new variant below.</p>
          </div>
        </div>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800">
          {product.variants.length} {product.variants.length === 1 ? "variant" : "variants"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {product.variants.map((v, i) => (
          <label
            key={v.variantId}
            className={`rounded-xl border p-2.5 text-xs transition-all ${
              Number(qty[v.variantId]) > 0
                ? "border-sky-400 bg-sky-50/80 shadow-2xs"
                : "border-slate-200 bg-white"
            }`}
          >
            <span className="block truncate font-bold text-slate-900">{variantLabel(v)}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {v.stock !== null ? `${v.stock} in stock` : "new"}
              {v.lastCostMinor !== null ? ` · ₹${(v.lastCostMinor / 100).toFixed(0)}` : ""}
            </span>
            <input
              ref={i === 0 ? firstRef : undefined}
              inputMode="numeric"
              value={qty[v.variantId] ?? ""}
              onChange={(e) => setQty({ ...qty, [v.variantId]: e.target.value })}
              placeholder="0"
              className="amb-focus mt-1.5 block min-h-9 w-full rounded-lg border border-slate-300 px-2 py-1 text-center font-bold tabular-nums text-slate-900"
            />
          </label>
        ))}

        {/* Option A: The "+ Add Size / Color" Ghost Card */}
        {!addingVariant && (
          <button
            type="button"
            onClick={() => setAddingVariant(true)}
            className="flex min-h-[92px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/30 p-2 text-center text-xs font-semibold text-sky-700 hover:border-sky-500 hover:bg-sky-100/50 transition-all cursor-pointer"
          >
            <Plus className="h-5 w-5 mb-1 text-sky-600" />
            <span>+ Add Size / Color</span>
            <span className="text-[10px] text-slate-500 font-normal">New variant in this bill?</span>
          </button>
        )}
      </div>

      {/* Inline Quick-Variant Builder matching Add Product Wizard UI & Theme */}
      {addingVariant && (
        <div className="mt-4 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm amb-fade-in ring-1 ring-primary/10">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Add New Size / Colour Variant to &ldquo;{product.name}&rdquo;
                </p>
                <p className="text-[11px] text-slate-500">
                  Inherits GST slab, UOM, and brand automatically. Pick sizes and confirm pricing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAddingVariant(false);
                setAddError(null);
              }}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>

          {addError && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{addError}</span>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {/* Sizes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Select Size(s) <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] font-medium text-slate-400">
                  {newSizes.length} selected
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {STANDARD_SIZES.map((sz) => {
                  const active = newSizes.includes(sz);
                  return (
                    <button
                      type="button"
                      key={sz}
                      onClick={() =>
                        setNewSizes((prev) =>
                          active ? prev.filter((s) => s !== sz) : [...prev, sz]
                        )
                      }
                      className={`h-9 min-w-[42px] rounded-xl px-3 text-xs font-bold transition-all ${
                        active
                          ? "bg-primary text-white shadow-xs ring-2 ring-primary/20"
                          : "border border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Colour Swatches */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Pick Colour Swatch (Optional)
                </label>
                {newColour && (
                  <span className="text-[11px] font-semibold text-primary">
                    Selected: {newColour}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
                {STANDARD_COLOURS.map((c) => {
                  const isSelected = newColour.toLowerCase() === c.name.toLowerCase();
                  return (
                    <button
                      type="button"
                      key={c.name}
                      onClick={() => setNewColour(isSelected ? "" : c.name)}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left transition-all ${
                        isSelected
                          ? "border-primary bg-sky-50/70 ring-2 ring-primary/20 shadow-2xs"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-slate-300 shadow-2xs"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-xs font-semibold text-slate-800 truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Colour input */}
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-500">Or custom colour:</span>
                <input
                  type="text"
                  placeholder="e.g. Royal Wine, Pastel Olive..."
                  value={newColour}
                  onChange={(e) => setNewColour(e.target.value)}
                  className="h-8 max-w-[240px] rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-medium text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Pricing Pre-filled from siblings */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cost Price (₹)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">
                    ₹
                  </span>
                  <input
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-7 pr-3 text-xs font-semibold text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Selling Price (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">
                    ₹
                  </span>
                  <input
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-7 pr-3 text-xs font-bold text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  MRP (₹)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">
                    ₹
                  </span>
                  <input
                    value={mrpInput}
                    onChange={(e) => setMrpInput(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-7 pr-3 text-xs font-semibold text-slate-900 focus:border-primary focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAddingVariant(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCreateNewVariant}
                className={`${buttonClass("primary")} text-xs font-bold px-4 py-2 shadow-xs`}
              >
                {isSubmitting ? "Creating Variant…" : "Create & Select Variant"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-sky-200 pt-3">
        <span className="text-xs font-semibold text-slate-700">
          {total} {total === 1 ? "piece" : "pieces"} selected
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={buttonClass("ghost")}>
            Cancel
          </button>
          <button type="button" onClick={add} disabled={total === 0} className={buttonClass("primary")}>
            Add to bill
          </button>
        </div>
      </div>
    </div>
  );
}

function NewProduct({
  initialName,
  onCreated,
  onAddDirect,
  onClose,
}: {
  initialName: string;
  onCreated: (p: PurchaseProductHit) => void;
  onAddDirect: (lines: PickedLine[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sizes, setSizes] = useState("");
  const [colours, setColours] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [price, setPrice] = useState("");
  const [fillQty, setFillQty] = useState("");
  const [uomCode, setUomCode] = useState("PCS");
  const [gstKey, setGstKey] = useState<string>("NON");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pricing mode: "SAME" (one common price for all sizes) or "CUSTOM" (individual size table)
  const [pricingMode, setPricingMode] = useState<"SAME" | "CUSTOM">("SAME");
  const [barcode, setBarcode] = useState("");
  const [sizePrices, setSizePrices] = useState<
    Record<string, { cost: string; mrp: string; price: string; qty?: string; barcode?: string; colour?: string }>
  >({});
  const [cameraScanFor, setCameraScanFor] = useState<string | null>(null);
  const [printModalVariants, setPrintModalVariants] = useState<PrintableVariantItem[] | null>(null);

  // Currently active sizes for scoped colour picking (empty array = applies to all/global)
  const [activeSizeFilters, setActiveSizeFilters] = useState<string[]>([]);

  const parsedSizes = useMemo(
    () =>
      sizes
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    [sizes]
  );

  const parsedColours = useMemo(
    () =>
      colours
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    [colours]
  );

  const toggleActiveSizeFilter = (sz: string) => {
    const upper = sz.trim().toUpperCase();
    setActiveSizeFilters((prev) =>
      prev.includes(upper) ? prev.filter((s) => s !== upper) : [...prev, upper]
    );
  };

  const selectAllSizeFilters = () => {
    setActiveSizeFilters(parsedSizes.map((s) => s.toUpperCase()));
  };

  const clearAllSizeFilters = () => {
    setActiveSizeFilters([]);
  };

  // Deleted keys set to respect manual row removals (e.g. "S__WHITE") when top pills are clicked
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

  // Additional custom combos added via per-row [+] or custom splits
  const [extraCombos, setExtraCombos] = useState<{ key: string; size: string; colour: string }[]>([]);

  // Refs for row colour inputs to auto-focus newly added rows
  const rowColourInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const STANDARD_GARMENT_COLOURS = [
    { name: "Black", hex: "#111827" },
    { name: "White", hex: "#F9FAFB", border: true },
    { name: "Navy", hex: "#1E3A8A" },
    { name: "Blue", hex: "#2563EB" },
    { name: "Sky Blue", hex: "#38BDF8" },
    { name: "Royal Blue", hex: "#1D4ED8" },
    { name: "Red", hex: "#DC2626" },
    { name: "Maroon", hex: "#800000" },
    { name: "Wine", hex: "#722F37" },
    { name: "Green", hex: "#16A34A" },
    { name: "Olive", hex: "#808000" },
    { name: "Bottle Green", hex: "#004225" },
    { name: "Mint", hex: "#6EE7B7" },
    { name: "Grey", hex: "#6B7280" },
    { name: "Dark Grey", hex: "#374151" },
    { name: "Beige", hex: "#D4B996" },
    { name: "Cream", hex: "#FFFDD0" },
    { name: "Brown", hex: "#78350F" },
    { name: "Tan", hex: "#D2B48C" },
    { name: "Khaki", hex: "#C3B091" },
    { name: "Pink", hex: "#EC4899" },
    { name: "Baby Pink", hex: "#FBCFE8" },
    { name: "Peach", hex: "#FDBA74" },
    { name: "Yellow", hex: "#EAB308" },
    { name: "Mustard", hex: "#D97706" },
    { name: "Orange", hex: "#F97316" },
    { name: "Purple", hex: "#9333EA" },
    { name: "Lavender", hex: "#C084FC" },
  ];

  const STANDARD_GARMENT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "FREE SIZE"];

  const toggleSizePill = (sizeName: string) => {
    const upper = sizeName.toUpperCase();
    if (parsedSizes.includes(upper)) {
      setSizes(parsedSizes.filter((s) => s !== upper).join(", "));
      setActiveSizeFilters((prev) => prev.filter((s) => s !== upper));
      setExtraCombos((prev) => prev.filter((e) => e.size.toUpperCase() !== upper));
    } else {
      setSizes([...parsedSizes, upper].join(", "));
      // Auto-target this newly selected size so colours chosen next belong only to this size!
      setActiveSizeFilters([upper]);
    }
  };

  const toggleColourPill = (colourName: string) => {
    const target = colourName.toUpperCase();

    // IF specific size targets are selected (e.g. user selected "Size S" or multiple sizes like "S, M"):
    // Add or remove this colour ONLY for those selected target sizes!
    if (activeSizeFilters.length > 0) {
      for (const targetSize of activeSizeFilters) {
        const sz = targetSize.toUpperCase();
        const comboKey = `${sz}__${target}`;
        const isAlreadyIn = combinations.some(
          (c) => c.size.toUpperCase() === sz && (c.colour ? c.colour.toUpperCase() === target : false)
        );

        if (isAlreadyIn) {
          removeComboRow(comboKey);
        } else {
          setDeletedKeys((d) => {
            const next = new Set(d);
            next.delete(comboKey);
            return next;
          });

          // Inherit pricing from sibling of same size or quick fill defaults
          const siblingKey = combinations.find((c) => c.size.toUpperCase() === sz)?.key;
          const siblingPricing = (siblingKey ? sizePrices[siblingKey] : null) || {
            cost: costPrice,
            mrp,
            price,
            qty: fillQty || "1",
            barcode: "",
          };

          setExtraCombos((prev) => [
            ...prev.filter((e) => e.key !== comboKey),
            { key: comboKey, size: sz, colour: target },
          ]);

          setSizePrices((prev) => ({
            ...prev,
            [comboKey]: {
              cost: siblingPricing.cost,
              mrp: siblingPricing.mrp,
              price: siblingPricing.price,
              qty: siblingPricing.qty || fillQty || "1",
              barcode: "",
              colour: target,
            },
          }));
        }
      }
      return;
    }

    // Default: Global colour toggle across all sizes
    const isCurrentlyActive = combinations.some((c) => c.colour.toUpperCase() === target);

    // Unblock this colour from deletedKeys for all current sizes
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      const sizesToCheck = parsedSizes.length > 0 ? parsedSizes : ["FREE SIZE"];
      for (const sz of sizesToCheck) {
        next.delete(`${sz.toUpperCase()}__${target}`);
      }
      return next;
    });

    if (isCurrentlyActive) {
      // Toggle OFF: remove colour from all combinations
      for (const combo of combinations) {
        if (combo.colour.toUpperCase() === target) {
          setDeletedKeys((d) => new Set(d).add(combo.key));
        }
      }
      setExtraCombos((prev) => prev.filter((e) => e.colour.toUpperCase() !== target));
      const nextColours = parsedColours.filter((c) => c !== target);
      setColours(nextColours.join(", "));
    } else {
      // Toggle ON: add colour
      const current = new Set(parsedColours);
      current.add(target);
      setColours(Array.from(current).join(", "));
    }
  };

  const combinations = useMemo(() => {
    // If user typed sizes, use them. If neither size nor colour is typed, default to FREE SIZE
    const hasSizes = parsedSizes.length > 0;
    const hasColours = parsedColours.length > 0;

    let sList: string[];
    let cList: string[];

    if (!hasSizes && !hasColours) {
      sList = ["FREE SIZE"];
      cList = [""];
    } else if (hasSizes && !hasColours) {
      sList = parsedSizes;
      cList = [""];
    } else if (!hasSizes && hasColours) {
      sList = ["FREE SIZE"];
      cList = parsedColours;
    } else {
      // Both sizes and colours selected
      sList = parsedSizes;
      cList = parsedColours;
    }

    const list: { key: string; size: string; colour: string }[] = [];
    const seen = new Set<string>();

    // When sizes exist and activeSizeFilters has active size(s), do not multiply all sizes with all colours!
    // Extra combos handle specific size-colour pairs.
    if (activeSizeFilters.length === 0) {
      for (const s of sList) {
        for (const c of cList) {
          const key = `${s.toUpperCase()}__${c.toUpperCase()}`;
          if (!deletedKeys.has(key)) {
            list.push({
              key,
              size: s,
              colour: c,
            });
            seen.add(key);
          }
        }
      }
    } else {
      // In targeted size mode, include default blank-colour rows for sizes not yet given extra colours
      for (const s of sList) {
        const hasExtra = extraCombos.some((e) => e.size.toUpperCase() === s.toUpperCase());
        if (!hasExtra) {
          const key = `${s.toUpperCase()}__`;
          if (!deletedKeys.has(key)) {
            list.push({ key, size: s, colour: "" });
            seen.add(key);
          }
        }
      }
    }

    // Add extra custom combos (per-row + or comma splits) that weren't deleted
    for (const extra of extraCombos) {
      const key = `${extra.size.toUpperCase()}__${extra.colour.toUpperCase()}`;
      if (!deletedKeys.has(key) && !seen.has(key)) {
        list.push({
          key,
          size: extra.size,
          colour: extra.colour,
        });
        seen.add(key);
      }
    }

    return list;
  }, [parsedSizes, parsedColours, deletedKeys, extraCombos, activeSizeFilters]);

  const marginCalculation = useMemo(() => {
    const cost = parseFloat(costPrice);
    const selling = parseFloat(price);

    if (isNaN(cost) || isNaN(selling) || cost <= 0 || selling <= 0) {
      return null;
    }

    const profit = selling - cost;
    const marginPercent = ((profit / selling) * 100).toFixed(1);
    const markupPercent = ((profit / cost) * 100).toFixed(1);

    return {
      profit: profit.toFixed(2),
      marginPercent,
      markupPercent,
      isPositive: profit >= 0,
    };
  }, [costPrice, price]);

  function applyQuickFill() {
    setSizePrices((prev) => {
      const next = { ...prev };
      for (const combo of combinations) {
        const cur = next[combo.key] || { cost: "", mrp: "", price: "", qty: "", barcode: "" };
        next[combo.key] = {
          ...cur,
          cost: costPrice.trim() ? costPrice : cur.cost,
          mrp: mrp.trim() ? mrp : cur.mrp,
          price: price.trim() ? price : cur.price,
          qty: fillQty.trim() ? fillQty : cur.qty,
        };
      }
      return next;
    });
  }

  // 1. Per-Row [+ Add Colour for this Size]
  function addColourForSize(combo: { key: string; size: string; colour: string }) {
    const parentPricing = sizePrices[combo.key] || {
      cost: costPrice,
      mrp,
      price,
      qty: fillQty || "1",
      barcode: "",
    };

    const newKey = `${combo.size.toUpperCase()}__CUSTOM_${Date.now().toString().slice(-4)}`;
    const newCombo = {
      key: newKey,
      size: combo.size,
      colour: "",
    };

    setExtraCombos((prev) => [...prev, newCombo]);
    setSizePrices((prev) => ({
      ...prev,
      [newKey]: {
        cost: parentPricing.cost,
        mrp: parentPricing.mrp,
        price: parentPricing.price,
        qty: parentPricing.qty || fillQty || "1",
        barcode: "",
      },
    }));

    setTimeout(() => {
      rowColourInputRefs.current[newKey]?.focus();
    }, 50);
  }

  // 2. Comma-Split Inside Row Colour Input
  function handleColourBlurOrEnter(combo: { key: string; size: string; colour: string }, val: string) {
    if (!val.includes(",")) return;

    const splitColours = val
      .split(/[,/]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (splitColours.length <= 1) return;

    const currentPricing = sizePrices[combo.key] || {
      cost: costPrice,
      mrp,
      price,
      qty: fillQty || "1",
      barcode: "",
    };

    // Mark current combo key as deleted if it's not one of the new split keys
    const firstColour = splitColours[0]!;
    const firstKey = `${combo.size.toUpperCase()}__${firstColour.toUpperCase()}`;

    const newExtraList: { key: string; size: string; colour: string }[] = [];
    const newPricesPatch: Record<string, { cost: string; mrp: string; price: string; qty?: string; barcode?: string }> = {};

    splitColours.forEach((clr, idx) => {
      const k = `${combo.size.toUpperCase()}__${clr.toUpperCase()}`;
      newExtraList.push({
        key: k,
        size: combo.size,
        colour: clr,
      });
      newPricesPatch[k] = {
        cost: currentPricing.cost,
        mrp: currentPricing.mrp,
        price: currentPricing.price,
        qty: currentPricing.qty || fillQty || "1",
        barcode: idx === 0 ? currentPricing.barcode : "",
      };
    });

    if (combo.key !== firstKey) {
      setDeletedKeys((d) => new Set(d).add(combo.key));
    }

    setExtraCombos((prev) => [
      ...prev.filter((e) => e.key !== combo.key),
      ...newExtraList,
    ]);

    setSizePrices((prev) => ({
      ...prev,
      ...newPricesPatch,
    }));
  }

  // 3. Remove Variant Row
  function removeComboRow(comboKey: string) {
    setDeletedKeys((d) => new Set(d).add(comboKey));
    setExtraCombos((prev) => prev.filter((e) => e.key !== comboKey));

    // Check if any other row still has this colour
    const targetCombo = combinations.find((c) => c.key === comboKey);
    if (targetCombo && targetCombo.colour) {
      const targetClr = targetCombo.colour.toUpperCase();
      const remainingCombos = combinations.filter((c) => c.key !== comboKey);
      const colourStillPresent = remainingCombos.some((c) => c.colour.toUpperCase() === targetClr);
      if (!colourStillPresent) {
        setColours(parsedColours.filter((c) => c !== targetClr).join(", "));
      }
    }
  }

  async function save() {
    const choice = GST_CHOICES.find((g) => g.key === gstKey);
    const baseCostMinor = costPrice.trim() ? Math.round(Number(costPrice.replaceAll(",", "")) * 100) : null;
    const basePriceMinor = price.trim() ? Math.round(Number(price.replaceAll(",", "")) * 100) : 0;
    const baseMrpMinor = mrp.trim() ? Math.round(Number(mrp.replaceAll(",", "")) * 100) : null;

    if (!name.trim()) {
      setError("Give the product a name.");
      return;
    }
    if (!choice) {
      setError("Choose the GST type.");
      return;
    }

    let customSizePrices: { size: string; colour?: string; costPriceMinor: number | null; priceMinor: number; mrpMinor: number | null; barcode?: string | null; quantity?: number }[] | undefined = undefined;
    let effectiveBasePrice = basePriceMinor;

    if (pricingMode === "SAME" || combinations.length <= 1) {
      if (!(basePriceMinor > 0)) {
        setError("Enter a valid selling price.");
        return;
      }
      if (baseMrpMinor !== null && basePriceMinor > baseMrpMinor) {
        setError("Selling price cannot exceed MRP.");
        return;
      }
    } else {
      // CUSTOM mode: validate every combination row
      customSizePrices = [];
      for (const combo of combinations) {
        const row = sizePrices[combo.key];
        const comboColour = (row?.colour !== undefined ? row.colour : combo.colour).trim();
        const sCost = row?.cost?.trim() ? Math.round(Number(row.cost.replaceAll(",", "")) * 100) : baseCostMinor;
        const sPrice = row?.price?.trim() ? Math.round(Number(row.price.replaceAll(",", "")) * 100) : basePriceMinor;
        const sMrp = row?.mrp?.trim() ? Math.round(Number(row.mrp.replaceAll(",", "")) * 100) : baseMrpMinor;
        const sBarcode = row?.barcode?.trim() || null;
        const sQty = row?.qty?.trim() ? parseInt(row.qty, 10) : (fillQty.trim() ? parseInt(fillQty, 10) : 1);

        if (!(sPrice > 0)) {
          setError(`Enter selling price for ${combo.size}${comboColour ? ` - ${comboColour}` : ""}.`);
          return;
        }
        if (sMrp !== null && sPrice > sMrp) {
          setError(`Selling price cannot exceed MRP for ${combo.size}${comboColour ? ` - ${comboColour}` : ""}.`);
          return;
        }
        customSizePrices.push({
          size: combo.size,
          colour: comboColour || undefined,
          costPriceMinor: sCost,
          priceMinor: sPrice,
          mrpMinor: sMrp,
          barcode: sBarcode,
          quantity: isNaN(sQty) ? 1 : Math.max(0, sQty),
        });
      }
      effectiveBasePrice = customSizePrices[0]?.priceMinor ?? (basePriceMinor || 100);
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/purchase-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          brand: brand || null,
          imageUrl: imageUrl || null,
          sizes: parsedSizes,
          colours: parsedColours,
          costPriceMinor: baseCostMinor,
          priceMinor: effectiveBasePrice,
          mrpMinor: baseMrpMinor,
          barcode: barcode.trim() || null,
          customSizePrices,
          uomCode: uomCode || "PCS",
          gst: { treatment: choice.treatment, rateMode: choice.rateMode, rateBp: choice.rateBp },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Couldn't add the product.");
        return;
      }

      // If user typed custom quantities in customSizePrices, enrich returned variants so onAddDirect appends straight into NewPurchaseForm!
      const product = data.product as PurchaseProductHit;
      if (product) {
        const linesToAdd: PickedLine[] = [];
        for (const v of product.variants) {
          const vKey = `${(v.size || "FREE SIZE").toUpperCase()}__${(v.colour || "").toUpperCase()}`;
          const customEntry = customSizePrices?.find(
            (cp) => `${(cp.size || "FREE SIZE").toUpperCase()}__${(cp.colour || "").toUpperCase()}` === vKey
          );
          const lineQty = customEntry?.quantity != null ? customEntry.quantity : (Number(fillQty) || 1);
          if (lineQty > 0) {
            linesToAdd.push({
              variant: {
                ...v,
                costPriceMinor: customEntry?.costPriceMinor ?? v.costPriceMinor ?? baseCostMinor,
                lastCostMinor: customEntry?.costPriceMinor ?? v.costPriceMinor ?? baseCostMinor,
                priceMinor: customEntry?.priceMinor ?? v.priceMinor,
                mrpMinor: customEntry?.mrpMinor ?? v.mrpMinor,
              },
              productName: product.name,
              quantity: lineQty,
            });
          }
        }
        if (linesToAdd.length > 0) {
          onAddDirect(linesToAdd);
          return;
        }
      }

      onCreated(data.product);
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }

  return (
    <div onKeyDown={handleKeyDown} className="amb-fade-in space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">New product (Quick Add)</p>
        <span className="text-xs text-slate-500">Press Enter anytime to save & add</span>
      </div>

      {/* Basic details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Product name <span className="text-rose-500">*</span>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cotton Kurta"
            className={`${INPUT} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Brand <span className="font-normal text-slate-500">(optional)</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Raymond, Zara..." className={`${INPUT} mt-1`} />
        </label>

        {/* Product Image Upload / Camera */}
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Product Image <span className="font-normal text-slate-500">(optional — upload file, take camera photo, or paste URL)</span>
          </label>
          <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
            <ProductImagePicker value={imageUrl} onChange={setImageUrl} disabled={busy} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">
              Sizes <span className="font-normal text-slate-500">(comma separated)</span>
            </label>
          </div>
          {/* Quick Garment Size Pills */}
          <div className="mt-1 flex flex-wrap gap-1">
            {STANDARD_GARMENT_SIZES.map((sz) => {
              const active = parsedSizes.includes(sz);
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => toggleSizePill(sz)}
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-700"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {sz}
                </button>
              );
            })}
          </div>
          <input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="S, M, L, XL" className={`${INPUT} mt-1.5`} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">
              Colours <span className="font-normal text-slate-500">(optional)</span>
            </label>
            {parsedSizes.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-slate-400 font-medium">Add to:</span>
                <button
                  type="button"
                  onClick={clearAllSizeFilters}
                  className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                    activeSizeFilters.length === 0
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={selectAllSizeFilters}
                  className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                    activeSizeFilters.length === parsedSizes.length
                      ? "bg-emerald-700 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Select All
                </button>
                {parsedSizes.map((sz) => {
                  const isSelected = activeSizeFilters.includes(sz.toUpperCase());
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => toggleActiveSizeFilter(sz)}
                      className={`rounded px-1.5 py-0.5 font-bold transition-all border ${
                        isSelected
                          ? "bg-emerald-700 text-white border-emerald-700 shadow-xs ring-1 ring-emerald-700"
                          : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
                      }`}
                    >
                      {sz} {isSelected && "✓"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {activeSizeFilters.length > 0 && (
            <div className="mt-1 rounded bg-emerald-100/60 px-2 py-0.5 text-[11px] text-emerald-950 flex flex-wrap items-center justify-between gap-1 border border-emerald-300">
              <span>
                🎯 <strong>Targeting {activeSizeFilters.length === 1 ? `Size ${activeSizeFilters[0]}` : `Sizes: ${activeSizeFilters.join(", ")}`}:</strong> Click colour pills to assign or remove colours for these sizes only.
              </span>
              <button
                type="button"
                onClick={clearAllSizeFilters}
                className="font-bold underline text-emerald-800 hover:text-emerald-950 ml-1.5"
              >
                Reset
              </button>
            </div>
          )}

          {/* Quick Garment Colour Pills with Dots */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {STANDARD_GARMENT_COLOURS.map((c) => {
              const cUpper = c.name.toUpperCase();
              const active =
                activeSizeFilters.length > 0
                  ? activeSizeFilters.every((sz) =>
                      combinations.some(
                        (combo) =>
                          combo.size.toUpperCase() === sz.toUpperCase() &&
                          combo.colour.toUpperCase() === cUpper
                      )
                    )
                  : combinations.some((combo) => combo.colour.toUpperCase() === cUpper) ||
                    parsedColours.includes(cUpper);
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => toggleColourPill(c.name)}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-all ${
                    active
                      ? "bg-slate-900 text-white shadow-sm ring-1 ring-slate-900"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${c.border ? "border border-slate-400" : ""}`}
                    style={{ backgroundColor: c.hex }}
                  />
                  {c.name}
                </button>
              );
            })}
          </div>
          <input value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Blue, Black" className={`${INPUT} mt-1.5`} />
        </div>
        <label className="text-sm font-medium text-slate-700">
          Unit of Measure (UOM)
          <select value={uomCode} onChange={(e) => setUomCode(e.target.value)} className={`${INPUT} mt-1`}>
            <option value="PCS">PCS / Pieces</option>
            <option value="NOS">NOS / Numbers</option>
            <option value="BOX">BOX</option>
            <option value="SET">SET</option>
            <option value="MTR">MTR / Metre</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          GST Classification <span className="text-rose-500">*</span>
          <select value={gstKey} onChange={(e) => setGstKey(e.target.value)} className={`${INPUT} mt-1`}>
            {GST_CHOICES.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Pricing Mode Selection when multiple sizes exist */}
      {parsedSizes.length > 1 && (
        <div className="flex items-center gap-4 rounded-lg bg-slate-100 p-1.5 text-xs font-semibold text-slate-700">
          <button
            type="button"
            onClick={() => setPricingMode("SAME")}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              pricingMode === "SAME" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All sizes have SAME price
          </button>
          <button
            type="button"
            onClick={() => setPricingMode("CUSTOM")}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              pricingMode === "CUSTOM" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Each size has DIFFERENT price
          </button>
        </div>
      )}

      {/* MODE 1: Single Common Price (When 1 size, or "SAME" mode is chosen) */}
      {(pricingMode === "SAME" || parsedSizes.length <= 1) ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm font-medium text-slate-700">
              Cost per piece (₹) <span className="font-normal text-slate-500">(Purchase Cost)</span>
              <input
                inputMode="decimal"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="500.00"
                className={`${INPUT} mt-1 tabular-nums`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              MRP (₹) <span className="font-normal text-slate-500">(Printed Price)</span>
              <input
                inputMode="decimal"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                placeholder="999"
                className={`${INPUT} mt-1 tabular-nums`}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Selling price (₹, incl. GST) <span className="text-rose-500">*</span>
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="799"
                className={`${INPUT} mt-1 tabular-nums`}
              />
            </label>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Barcode / Tag <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const rand = `20${Math.floor(100000 + Math.random() * 900000)}`;
                      setBarcode(rand);
                    }}
                    title="Auto-generate 8-digit POS barcode"
                    className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 hover:underline"
                  >
                    <Sparkles className="h-3 w-3" />
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setCameraScanFor("main")}
                    title="Scan using device camera"
                    className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:underline"
                  >
                    <Camera className="h-3 w-3" />
                    Scan
                  </button>
                </div>
              </div>
              <div className="relative mt-1">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Click & scan gun / Auto"
                  className={`${INPUT} font-mono text-xs pr-8`}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                  <ScanLine className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500 flex items-center justify-between">
            <span>✨ <strong>Setup 1 (Auto):</strong> Leave barcode empty to auto-generate thermal 8-digit code (20xxxxxx).</span>
            <span>🏷️ <strong>Setup 2 (BarTender):</strong> Scan pre-printed tag directly into barcode box.</span>
          </div>

          {marginCalculation && (
            <div className="rounded-xl border border-emerald-300 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-emerald-950">Calculated Profit &amp; Margin:</span>
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-slate-500">Profit / Piece:</span>{" "}
                    <strong className={`font-bold ${marginCalculation.isPositive ? "text-slate-900" : "text-rose-600"}`}>
                      ₹{marginCalculation.profit}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Gross Margin:</span>{" "}
                    <span
                      className={`rounded px-1.5 py-0.5 font-bold text-white ${
                        marginCalculation.isPositive ? "bg-emerald-600" : "bg-rose-600"
                      }`}
                    >
                      {marginCalculation.marginPercent}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Markup:</span>{" "}
                    <strong className="text-emerald-800 font-bold">{marginCalculation.markupPercent}%</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MODE 2: Individual Price Table Per Size/Colour (Clean Cartesian table) */
        <div className="rounded-xl border border-emerald-300 bg-white p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-900">
                Variant Matrix ({combinations.length} variants: Sizes × Colours):
              </p>
              <div className="text-[11px] text-slate-500">
                Leave barcode empty for <strong>Setup 1 (Auto POS tag)</strong> or scan for <strong>Setup 2 (BarTender tag)</strong>
              </div>
            </div>

            {/* Quick Fill Bar */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-xs">
              <span className="font-semibold text-emerald-950">Quick Fill All:</span>
              <input
                inputMode="numeric"
                value={fillQty}
                onChange={(e) => setFillQty(e.target.value)}
                placeholder="Qty"
                className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-center font-bold tabular-nums text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
              <input
                inputMode="decimal"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="Cost ₹"
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 tabular-nums text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
              <input
                inputMode="decimal"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                placeholder="MRP ₹"
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 tabular-nums text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Sell ₹"
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 tabular-nums text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={applyQuickFill}
                className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
              >
                Apply All
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2 pr-2">Size</th>
                  <th className="py-2 pr-2">Colour</th>
                  <th className="py-2 pr-2 text-center">Received Qty</th>
                  <th className="py-2 pr-2">Cost / Piece (₹)</th>
                  <th className="py-2 pr-2">MRP (₹)</th>
                  <th className="py-2 pr-2">Selling Price (₹) *</th>
                  <th className="py-2 pr-2">Barcode (Scan / Auto)</th>
                  <th className="py-2 text-right">Profit / Margin</th>
                  <th className="py-2 text-center w-14">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {combinations.map((combo) => {
                  const key = combo.key;
                  const custom = sizePrices[key] ?? { cost: "", mrp: "", price: "", qty: fillQty || "1", barcode: "" };
                  const cNum = parseFloat(custom.cost);
                  const pNum = parseFloat(custom.price);
                  const hasProfit = !isNaN(cNum) && !isNaN(pNum) && cNum > 0 && pNum > 0;
                  const profit = hasProfit ? (pNum - cNum).toFixed(2) : null;
                  const margin = hasProfit ? (((pNum - cNum) / pNum) * 100).toFixed(0) + "%" : "—";

                  return (
                    <tr key={key} className="hover:bg-slate-50">
                      <td className="py-2 pr-2 font-bold text-slate-900 text-sm">{combo.size}</td>
                      <td className="py-2 pr-2 font-medium text-slate-600">
                        <input
                          ref={(el) => {
                            rowColourInputRefs.current[key] = el;
                          }}
                          value={custom.colour !== undefined ? custom.colour : combo.colour}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSizePrices({
                              ...sizePrices,
                              [key]: { ...custom, colour: val },
                            });
                          }}
                          onBlur={(e) => handleColourBlurOrEnter(combo, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.currentTarget.value.includes(",")) {
                              e.preventDefault();
                              handleColourBlurOrEnter(combo, e.currentTarget.value);
                            }
                          }}
                          placeholder="Colour (e.g. Red, Blue)"
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <input
                          inputMode="numeric"
                          value={custom.qty ?? "1"}
                          onChange={(e) =>
                            setSizePrices({
                              ...sizePrices,
                              [key]: { ...custom, qty: e.target.value },
                            })
                          }
                          placeholder="1"
                          className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center font-bold tabular-nums text-xs focus:border-emerald-500"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-slate-400 text-xs">₹</span>
                          <input
                            inputMode="decimal"
                            value={custom.cost}
                            onChange={(e) =>
                              setSizePrices({
                                ...sizePrices,
                                [key]: { ...custom, cost: e.target.value },
                              })
                            }
                            placeholder="0.00"
                            className="w-24 rounded-md border border-slate-300 pl-4 pr-1.5 py-1.5 tabular-nums text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-slate-400 text-xs">₹</span>
                          <input
                            inputMode="decimal"
                            value={custom.mrp}
                            onChange={(e) =>
                              setSizePrices({
                                ...sizePrices,
                                [key]: { ...custom, mrp: e.target.value },
                              })
                            }
                            placeholder="0.00"
                            className="w-24 rounded-md border border-slate-300 pl-4 pr-1.5 py-1.5 tabular-nums text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-slate-400 text-xs">₹</span>
                          <input
                            inputMode="decimal"
                            value={custom.price}
                            onChange={(e) =>
                              setSizePrices({
                                ...sizePrices,
                                [key]: { ...custom, price: e.target.value },
                              })
                            }
                            placeholder="0.00"
                            className="w-24 rounded-md border border-slate-300 pl-4 pr-1.5 py-1.5 tabular-nums text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-1">
                          <div className="relative">
                            <input
                              value={custom.barcode || ""}
                              onChange={(e) =>
                                setSizePrices({
                                  ...sizePrices,
                                  [key]: { ...custom, barcode: e.target.value },
                                })
                              }
                              placeholder="Scan gun / Auto"
                              className="w-32 rounded-md border border-slate-300 pl-2 pr-6 py-1.5 font-mono text-xs focus:border-emerald-500"
                            />
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-slate-400">
                              <ScanLine className="h-3 w-3" />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const rand = `20${Math.floor(100000 + Math.random() * 900000)}`;
                              setSizePrices({
                                ...sizePrices,
                                [key]: { ...custom, barcode: rand },
                              });
                            }}
                            title="Auto-generate 8-digit POS barcode"
                            className="p-1 rounded text-slate-400 hover:text-emerald-700 hover:bg-slate-100"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCameraScanFor(`combo:${key}`)}
                            title="Scan with camera"
                            className="p-1 rounded text-slate-400 hover:text-sky-700 hover:bg-slate-100"
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        {profit ? (
                          <span className="font-semibold text-emerald-700">
                            ₹{profit} ({margin})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => addColourForSize(combo)}
                            title={`Add another colour for size ${combo.size}`}
                            className="p-1 rounded text-emerald-700 hover:bg-emerald-100 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeComboRow(key)}
                            title="Remove variant"
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">
        A unique SKU is made for each size and colour automatically. You can scan or customize barcodes later in Products.
      </p>
      {error && (
        <p role="alert" className="text-sm font-medium text-rose-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={buttonClass("ghost")}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={busy} className={buttonClass("primary")}>
          {busy ? "Adding…" : "Save & Add to Invoice (Enter)"}
        </button>
      </div>

      {cameraScanFor && (
        <CameraBarcodeScannerModal
          isOpen={Boolean(cameraScanFor)}
          onClose={() => setCameraScanFor(null)}
          onScan={(scanned) => {
            if (cameraScanFor === "main") {
              setBarcode(scanned);
            } else if (cameraScanFor.startsWith("combo:")) {
              const comboKey = cameraScanFor.replace("combo:", "");
              const current = sizePrices[comboKey] ?? { cost: "", mrp: "", price: "" };
              setSizePrices({
                ...sizePrices,
                [comboKey]: { ...current, barcode: scanned },
              });
            } else if (cameraScanFor.startsWith("size:")) {
              const sz = cameraScanFor.replace("size:", "");
              const current = sizePrices[sz] ?? { cost: "", mrp: "", price: "" };
              setSizePrices({
                ...sizePrices,
                [sz]: { ...current, barcode: scanned },
              });
            }
            setCameraScanFor(null);
          }}
        />
      )}
    </div>
  );
}

export function PurchaseItemPicker({
  initialQuery = "",
  autoFocus = false,
  onAdd,
  onPick,
  canCreate = true,
  canCreateProducts = true,
}: {
  initialQuery?: string;
  autoFocus?: boolean;
  onAdd?: (lines: PickedLine[]) => void;
  onPick?: (lines: PickedLine[]) => void;
  canCreate?: boolean;
  canCreateProducts?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PurchaseProductHit[]>([]);
  const [open, setOpen] = useState<PurchaseProductHit | null>(null);
  const [creating, setCreating] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const effectiveCanCreate = canCreateProducts ?? canCreate ?? true;
  const handleAdd = onAdd || onPick || (() => {});

  useEffect(() => {
    if (autoFocus) searchInputRef.current?.focus();
  }, [autoFocus]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/purchase-items?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setResults(data.results ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function done(lines: PickedLine[]) {
    handleAdd(lines);
    setOpen(null);
    setQuery("");
    setResults([]);
    searchInputRef.current?.focus();
  }

  // Exact-barcode / single-item match auto-select
  const shown = results;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (open) setOpen(null);
            if (creating) setCreating(false);
          }}
          placeholder="Scan barcode or type product name / SKU to add to bill…"
          className="amb-focus block h-14 w-full rounded-xl border-2 border-slate-300 bg-white pl-11 pr-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-sky-600"
        />
      </div>

      {open ? (
        <SizeGrid product={open} onAdd={done} onClose={() => setOpen(null)} />
      ) : creating ? (
        <NewProduct
          initialName={query}
          onClose={() => setCreating(false)}
          onAddDirect={(lines) => {
            setCreating(false);
            done(lines);
          }}
          onCreated={(p) => {
            setCreating(false);
            setOpen(p);
          }}
        />
      ) : (
        query.length >= 2 && (
          <div className="amb-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white">
            {shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-600">{loading ? "Searching…" : `No product matches “${query}”.`}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((p) => (
                  <li key={p.productId}>
                    <button
                      type="button"
                      onClick={() => setOpen(p)}
                      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left hover:bg-sky-50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="h-10 w-10 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-xs font-bold shrink-0">
                            {p.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {p.name}
                            {p.brand && <span className="font-normal text-slate-500"> ({p.brand})</span>}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {p.variants.length} {p.variants.length === 1 ? "variant" : "sizes/colours"}:{" "}
                            {p.variants.slice(0, 6).map(variantLabel).join(", ")}
                            {p.variants.length > 6 ? "…" : ""}
                          </span>
                        </span>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-sky-700">Choose sizes →</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {effectiveCanCreate && !loading && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-12 w-full cursor-pointer items-center gap-2 border-t border-slate-100 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <PackagePlus aria-hidden="true" className="h-4 w-4" />
                New product{query ? ` “${query}”` : ""}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
