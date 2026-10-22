"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  UploadCloud,
  X,
  Image as ImageIcon,
  Loader2,
  Camera,
  ScanLine,
  Sparkles,
  TrendingUp,
  Layers,
  Plus,
  Copy,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { buttonClass } from "../_components/ui";
import { GstTaxFields, readTaxRate } from "./GstTaxFields";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";

const STANDARD_GARMENT_SIZES = ["S", "M", "L", "XL", "XXL", "Free Size"];

export const STANDARD_GARMENT_COLOURS = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Navy", hex: "#000080" },
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

export function skuColourPart(colour: string | null | undefined): string {
  if (!colour) return "STD";
  const clean = colour.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length <= 4) return clean || "CLR";
  // Pick first 3-4 chars
  return clean.slice(0, 3);
}

const variantRowSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().nullable().optional(),
  barcode: z.string().trim().nullable().optional(),
  size: z.string().trim().nullable().optional(),
  colour: z.string().trim().nullable().optional(),
  costPriceMinor: z.number().min(0, "Cost price cannot be negative").nullable().optional(),
  priceMinor: z.number().min(0, "Selling price cannot be negative"),
  mrpMinor: z.number().min(0, "MRP cannot be negative").nullable().optional(),
  taxRateBp: z.number().int().min(0),
  taxRateMode: z.enum(["FIXED", "APPAREL_SLAB"]).optional(),
  taxTreatment: z.string().min(1),
  taxExemptionRef: z.string().nullable().optional(),
  openingQty: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().default(true),
});

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().nullable().optional(),
  brand: z.string().trim().nullable().optional(),
  baseUomId: z.string().min(1, "Base unit of measure is required"),
  isActive: z.boolean().default(true),
  imageUrl: z.string().nullable().optional(),
  variant: variantRowSchema.optional(),
  variants: z.array(variantRowSchema).optional(),
});

export interface ExistingVariantData {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  costPriceMinor?: number | null;
  priceMinor: number;
  mrpMinor: number | null;
  taxRateBp?: number;
  taxRateMode?: string;
  taxTreatment?: string;
  taxExemptionRef?: string | null;
  isActive: boolean;
  stockQuantity?: number | null;
}

interface SizeVariantRowData {
  id?: string;
  size: string;
  colour: string;
  cost: string;
  mrp: string;
  price: string;
  sku: string;
  barcode: string;
  openingQty: string;
  stock?: number | null;
  isActive: boolean;
  isManual?: boolean;
}

export function ProductForm({
  initialData,
  uoms = [],
}: {
  initialData?: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    baseUomId: string | null;
    isActive: boolean;
    imageUrl?: string | null;
    variants?: ExistingVariantData[];
  };
  uoms?: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const isCreate = !initialData;

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Image Upload State
  const [imageUrl, setImageUrl] = useState<string | null>(initialData?.imageUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quick fill common rate & quantity inputs
  const [costPrice, setCostPrice] = useState<string>("");
  const [sellingPrice, setSellingPrice] = useState<string>("");
  const [mrpPrice, setMrpPrice] = useState<string>("");
  const [fillQty, setFillQty] = useState<string>("");
  const [sizeInput, setSizeInput] = useState<string>("");
  const [colourInput, setColourInput] = useState<string>("");

  // Default Tax Settings (taken from first existing variant or default)
  const defaultTaxTreatment = initialData?.variants?.[0]?.taxTreatment || "TAXABLE";
  const defaultTaxRateMode = initialData?.variants?.[0]?.taxRateMode || "APPAREL_SLAB";
  const defaultTaxRateBp = initialData?.variants?.[0]?.taxRateBp ?? 500;

  // Multi-Size Rate Table Mode
  const [isMultiRateMode, setIsMultiRateMode] = useState(
    Boolean(initialData?.variants && initialData.variants.length > 0)
  );

  // Multi-Size table rows
  const [tableRows, setTableRows] = useState<SizeVariantRowData[]>(() => {
    if (initialData?.variants && initialData.variants.length > 0) {
      return initialData.variants.map((v) => ({
        id: v.id,
        size: v.size || "Free Size",
        colour: v.colour || "",
        cost: v.costPriceMinor != null ? (v.costPriceMinor / 100).toFixed(2) : "",
        mrp: v.mrpMinor != null ? (v.mrpMinor / 100).toFixed(2) : "",
        price: (v.priceMinor / 100).toFixed(2),
        sku: v.sku,
        barcode: v.barcode || "",
        openingQty: "",
        stock: v.stockQuantity ?? null,
        isActive: v.isActive,
      }));
    }
    return [];
  });

  const [cameraScannerForIndex, setCameraScannerForIndex] = useState<number | null>(null);

  // Currently active sizes for scoped colour picking (empty array = applies to all/global)
  const [activeSizeFilters, setActiveSizeFilters] = useState<string[]>([]);

  // Toggle a single size in the scoped colour target filter (or select/deselect multiple)
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

  // Set of deleted row keys (e.g. "S__WHITE") to respect manual deletions when top size/colour pills are clicked
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

  // Refs for auto-advancing rapid barcode gun scans (Enter key)
  const barcodeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Refs for row colour inputs (to focus newly added colour rows)
  const colourInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Parse entered sizes in Create mode
  const parsedSizes = useMemo(() => {
    if (!sizeInput.trim()) return [];
    return sizeInput
      .split(/[,/;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
  }, [sizeInput]);

  // Parse entered colours in Create mode
  const parsedColours = useMemo(() => {
    if (!colourInput.trim()) return [];
    return colourInput
      .split(/[,/;]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length > 0);
  }, [colourInput]);

  // In Create mode, keep tableRows in sync with Sizes × Colours Cartesian cross-product
  // Rows are keyed by `${size}__${colour}` to strictly PRESERVE typed state (Cost, MRP, Sell, Barcode, Qty)
  // Smart merge handles transition when 0 colours -> 1 colour (e.g. S | "" merges in-place into S | BLACK)
  useEffect(() => {
    if (!isCreate) return;
    if (parsedSizes.length === 0 && parsedColours.length === 0) {
      // FIX 1: Deselect bug fix - if user deselects all pills, keep only manually added rows
      setTableRows((prev) => prev.filter((r) => r.isManual));
      return;
    }

    // If specific sizes are targeted, colours are handled directly by togglePresetColour for those sizes!
    // We only auto-cross-multiply if activeSizeFilters is empty (All Sizes mode)
    if (activeSizeFilters.length > 0) {
      return;
    }

    const hasSizes = parsedSizes.length > 0;
    const hasColours = parsedColours.length > 0;

    // FIX 1: Never leak "FREE SIZE" if specific sizes are chosen!
    const effectiveSizes = hasSizes ? parsedSizes : ["FREE SIZE"];
    const effectiveColours = hasColours ? parsedColours : [""];

    setTableRows((prev) => {
      // 1. Separate explicit manual rows from matrix-driven rows
      const manualRows: SizeVariantRowData[] = [];
      const matrixPrevMap = new Map<string, SizeVariantRowData>();
      const sizeOnlyMap = new Map<string, SizeVariantRowData>(); // For merging when colour was empty
      const colourOnlyMap = new Map<string, SizeVariantRowData>(); // For merging when size was FREE SIZE

      for (const row of prev) {
        if (row.isManual) {
          manualRows.push(row);
          continue;
        }

        const rowSizeUpper = row.size.trim().toUpperCase();
        const rowClrUpper = row.colour.trim().toUpperCase();
        const key = `${rowSizeUpper}__${rowClrUpper}`;
        matrixPrevMap.set(key, row);

        if (!rowClrUpper) {
          sizeOnlyMap.set(rowSizeUpper, row);
        }
        if (rowSizeUpper === "FREE SIZE") {
          colourOnlyMap.set(rowClrUpper, row);
        }
      }

      const nextRows: SizeVariantRowData[] = [];
      for (const sz of effectiveSizes) {
        for (const clr of effectiveColours) {
          const szUpper = sz.trim().toUpperCase();
          const clrUpper = clr.trim().toUpperCase();
          const key = `${szUpper}__${clrUpper}`;

          // If user explicitly deleted this combination, respect it
          if (deletedKeys.has(key)) continue;

          // 2. Exact match check
          let existing = matrixPrevMap.get(key);

          // 3. Smart in-place merge:
          // If we had row (S, "") and now user selected colour "BLACK", reuse S's typed row!
          if (!existing && clrUpper) {
            const priorSizeRow = sizeOnlyMap.get(szUpper);
            if (priorSizeRow) {
              existing = { ...priorSizeRow, colour: clr };
            }
          }

          // If we had row ("FREE SIZE", "BLACK") and now user selected size "S", upgrade BLACK's typed row to S!
          if (!existing && szUpper !== "FREE SIZE") {
            const priorColourRow = colourOnlyMap.get(clrUpper);
            if (priorColourRow) {
              existing = { ...priorColourRow, size: sz };
            }
          }

          if (existing) {
            const rowSku = existing.sku || `SKU-${szUpper}-${skuColourPart(clrUpper)}-${(nextRows.length + 1).toString().padStart(2, "0")}`;
            nextRows.push({ ...existing, size: sz, colour: clr, sku: rowSku });
          } else {
            const rowSku = `SKU-${szUpper}-${skuColourPart(clrUpper)}-${(nextRows.length + 1).toString().padStart(2, "0")}`;
            nextRows.push({
              size: sz,
              colour: clr,
              cost: costPrice,
              mrp: mrpPrice,
              price: sellingPrice,
              sku: rowSku,
              barcode: "",
              openingQty: fillQty || "",
              stock: null,
              isActive: true,
              isManual: false,
            });
          }
        }
      }

      // 4. Preserve truly manual rows that weren't deleted
      for (const manual of manualRows) {
        const manualKey = `${manual.size.trim().toUpperCase()}__${manual.colour.trim().toUpperCase()}`;
        if (!deletedKeys.has(manualKey)) {
          nextRows.push(manual);
        }
      }

      return nextRows;
    });
  }, [isCreate, parsedSizes, parsedColours, deletedKeys, activeSizeFilters]);

  // Single variant live margin calculation for quick-fill row
  const singleMarginCalculation = useMemo(() => {
    const cost = parseFloat(costPrice);
    const selling = parseFloat(sellingPrice);

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
  }, [costPrice, sellingPrice]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    } catch {
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

  function togglePresetSize(size: string) {
    const target = size.trim().toUpperCase();
    const current = new Set(parsedSizes);

    if (current.has(target)) {
      current.delete(target);
      // Also remove from activeSizeFilters if it was selected there
      setActiveSizeFilters((prev) => prev.filter((s) => s !== target));
      // Remove any rows for this size from table
      setTableRows((prev) => prev.filter((r) => r.size.trim().toUpperCase() !== target));
    } else {
      current.add(target);
      // Keep "All Sizes" active by default so if user selects S, M, L and clicks Black, Black applies to all of them!
      // If user wants specific sizes, they can click "Size S", "Size M", or "Size L" in the targeting bar.
      setActiveSizeFilters([]);

      // Add default blank-colour row for this newly added size so it appears in the table immediately
      setTableRows((prev) => {
        const szUpper = target;
        const alreadyExists = prev.some((r) => r.size.trim().toUpperCase() === szUpper);
        if (alreadyExists) return prev;

        const sibling = prev[0];
        const idx = prev.length + 1;
        const newRow: SizeVariantRowData = {
          size: szUpper,
          colour: "",
          cost: sibling ? sibling.cost : costPrice,
          mrp: sibling ? sibling.mrp : mrpPrice,
          price: sibling ? sibling.price : (sellingPrice || "0.00"),
          sku: `SKU-${szUpper}-STD-${idx.toString().padStart(2, "0")}`,
          barcode: "",
          openingQty: sibling ? sibling.openingQty : (fillQty || ""),
          stock: null,
          isActive: true,
          isManual: true,
        };
        return [...prev, newRow];
      });
    }
    const joined = Array.from(current).join(", ");
    setSizeInput(joined);

    if (current.size > 1) {
      setIsMultiRateMode(true);
    }
  }

  function togglePresetColour(colourName: string) {
    const target = colourName.trim().toUpperCase();

    // IF specific size targets are selected (e.g. user selected "Size S" or multiple sizes like "S, M"):
    // Add or remove this colour ONLY for those selected target sizes!
    if (activeSizeFilters.length > 0) {
      setTableRows((prev) => {
        let updated = [...prev];

        for (const targetSize of activeSizeFilters) {
          const sz = targetSize.trim().toUpperCase();
          const rowKey = `${sz}__${target}`;
          const existingRowIdx = updated.findIndex(
            (r) => r.size.trim().toUpperCase() === sz && r.colour.trim().toUpperCase() === target
          );

          if (existingRowIdx >= 0) {
            // Toggle OFF: remove this specific colour row for this size
            setDeletedKeys((d) => new Set(d).add(rowKey));
            updated = updated.filter((_, i) => i !== existingRowIdx);
          } else {
            // Toggle ON: add this specific colour row for this size
            setDeletedKeys((d) => {
              const next = new Set(d);
              next.delete(rowKey);
              return next;
            });

            // Find reference pricing from other rows of same size or quick fill
            const sibling = updated.find((r) => r.size.trim().toUpperCase() === sz);
            const clrCode = skuColourPart(target);
            const rowNumber = (updated.length + 1).toString().padStart(2, "0");
            const autoSku = `SKU-${sz}-${clrCode}-${rowNumber}`;

            // Check if there is a blank colour row for this size (e.g. S | "") -> upgrade in-place
            const blankIdx = updated.findIndex(
              (r) => r.size.trim().toUpperCase() === sz && !r.colour.trim()
            );

            if (blankIdx >= 0) {
              const blankRow = updated[blankIdx]!;
              const blankRowNumber = (blankIdx + 1).toString().padStart(2, "0");
              const upgradedSku = `SKU-${sz}-${clrCode}-${blankRowNumber}`;
              updated[blankIdx] = { ...blankRow, colour: target, sku: upgradedSku };
            } else {
              const newRow: SizeVariantRowData = {
                size: sz,
                colour: target,
                cost: sibling ? sibling.cost : costPrice,
                mrp: sibling ? sibling.mrp : mrpPrice,
                price: sibling ? sibling.price : (sellingPrice || "0.00"),
                sku: autoSku,
                barcode: "",
                openingQty: sibling ? sibling.openingQty : (fillQty || ""),
                stock: null,
                isActive: true,
                isManual: true, // Keep it isolated so other sizes don't get touched
              };
              updated.push(newRow);
            }
          }
        }

        return updated;
      });
      return;
    }

    // Default: Global colour toggle across all sizes
    // Active if ALL parsed sizes have this colour
    const isCurrentlyActive =
      parsedSizes.length > 0
        ? parsedSizes.every((sz) =>
            tableRows.some(
              (r) =>
                r.size.trim().toUpperCase() === sz &&
                r.colour.trim().toUpperCase() === target
            )
          )
        : tableRows.some((r) => r.colour.trim().toUpperCase() === target);
    
    // Always clear target colour from deletedKeys for all parsed sizes so user can re-add it without block
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      const sizesToCheck = parsedSizes.length > 0 ? parsedSizes : ["FREE SIZE"];
      for (const sz of sizesToCheck) {
        next.delete(`${sz.toUpperCase()}__${target}`);
      }
      return next;
    });

    if (isCurrentlyActive) {
      // Toggle OFF: Remove rows of this colour from the table
      setTableRows((prev) => prev.filter((r) => r.colour.trim().toUpperCase() !== target));
      const nextColours = parsedColours.filter((c) => c !== target);
      setColourInput(nextColours.join(", "));
    } else {
      // Toggle ON: Add colour to all parsed sizes!
      const current = new Set(parsedColours);
      current.add(target);
      const joined = Array.from(current).join(", ");
      setColourInput(joined);

      // Immediately populate matrix rows for ALL selected sizes (S, M, L, etc.) with auto SKUs!
      setTableRows((prev) => {
        const sizesToApply = parsedSizes.length > 0 ? parsedSizes : ["FREE SIZE"];
        let updated = [...prev];
        sizesToApply.forEach((sz) => {
          const szUpper = sz.toUpperCase();
          const clrUpper = target;
          const clrCode = skuColourPart(clrUpper);

          // If there's an existing blank colour row for this size (e.g. S | "") -> upgrade in-place
          const blankIdx = updated.findIndex(
            (r) => r.size.trim().toUpperCase() === szUpper && !r.colour.trim()
          );

          if (blankIdx >= 0) {
            const blankRow = updated[blankIdx]!;
            updated[blankIdx] = {
              ...blankRow,
              colour: clrUpper,
              sku: `SKU-${szUpper}-${clrCode}-${(blankIdx + 1).toString().padStart(2, "0")}`,
            };
          } else {
            const exists = updated.some(
              (r) => r.size.trim().toUpperCase() === szUpper && r.colour.trim().toUpperCase() === clrUpper
            );
            if (!exists) {
              const sibling = updated.find((r) => r.size.trim().toUpperCase() === szUpper);
              const rowNumber = (updated.length + 1).toString().padStart(2, "0");
              const autoSku = `SKU-${szUpper}-${clrCode}-${rowNumber}`;
              updated.push({
                size: szUpper,
                colour: clrUpper,
                cost: sibling ? sibling.cost : costPrice,
                mrp: sibling ? sibling.mrp : mrpPrice,
                price: sibling ? sibling.price : (sellingPrice || "0.00"),
                sku: autoSku,
                barcode: "",
                openingQty: sibling ? sibling.openingQty : (fillQty || ""),
                stock: null,
                isActive: true,
                isManual: true,
              });
            }
          }
        });
        return updated;
      });
    }

    setIsMultiRateMode(true);
  }

  function updateRow(index: number, patch: Partial<SizeVariantRowData>) {
    setTableRows((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        const updated = { ...copy[index]!, ...patch };
        // If size or colour changed, and SKU was either empty or auto-generated, refresh SKU!
        if (
          ("size" in patch || "colour" in patch) &&
          (!updated.sku || updated.sku.startsWith("SKU-"))
        ) {
          const szPart = (updated.size || "STD").trim().toUpperCase();
          const clrPart = skuColourPart(updated.colour);
          const rowNum = (index + 1).toString().padStart(2, "0");
          updated.sku = `SKU-${szPart}-${clrPart}-${rowNum}`;
        }
        copy[index] = updated;
      }
      return copy;
    });
  }

  function addNewVariantRow() {
    setTableRows((prev) => {
      const idx = prev.length + 1;
      const clr = parsedColours[0] || "";
      const clrPart = skuColourPart(clr);
      return [
        ...prev,
        {
          size: "M",
          colour: clr,
          cost: costPrice,
          mrp: mrpPrice,
          price: sellingPrice || "0.00",
          sku: `SKU-M-${clrPart}-${idx.toString().padStart(2, "0")}`,
          barcode: "",
          openingQty: fillQty || "",
          stock: null,
          isActive: true,
          isManual: true,
        },
      ];
    });
  }

  function removeVariantRow(index: number) {
    setTableRows((prev) => {
      const target = prev[index];
      if (target) {
        const key = `${target.size.toUpperCase()}__${target.colour.toUpperCase()}`;
        setDeletedKeys((d) => new Set(d).add(key));

        const targetClr = target.colour.trim().toUpperCase();
        if (targetClr) {
          // Check if any other row in the remaining rows uses this colour
          const remainingRows = prev.filter((_, i) => i !== index);
          const colourStillExists = remainingRows.some(
            (r) => r.colour.trim().toUpperCase() === targetClr
          );
          if (!colourStillExists) {
            // Prune from colourInput so the top pill un-highlights
            const updatedColours = parsedColours.filter((c) => c !== targetClr);
            setColourInput(updatedColours.join(", "));
          }
        }
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  // 1. Per-Row [+ Add Colour for this Size]: inserts new row directly below, copies pricing/qty, generates SKU, focuses Colour
  function addColourForSize(index: number) {
    const parentRow = tableRows[index];
    if (!parentRow) return;

    const newRowIndex = index + 1;
    const clrPart = skuColourPart("");
    const newSku = `SKU-${parentRow.size.toUpperCase()}-${clrPart}-${(tableRows.length + 1).toString().padStart(2, "0")}`;

    const newRow: SizeVariantRowData = {
      size: parentRow.size,
      colour: "",
      cost: parentRow.cost,
      mrp: parentRow.mrp,
      price: parentRow.price,
      sku: newSku,
      barcode: "",
      openingQty: parentRow.openingQty,
      stock: null,
      isActive: true,
      isManual: true,
    };

    setTableRows((prev) => {
      const copy = [...prev];
      copy.splice(newRowIndex, 0, newRow);
      return copy;
    });

    // Auto-focus the new row's colour input
    setTimeout(() => {
      const inputEl = colourInputRefs.current[newRowIndex];
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 50);
  }

  // 2. Comma-Split Inside Any Row's Colour Box
  function handleColourBlurOrEnter(index: number, value: string) {
    if (!value.includes(",")) return;

    const splitColours = value
      .split(/[,/]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (splitColours.length <= 1) return;

    setTableRows((prev) => {
      const currentRow = prev[index];
      if (!currentRow) return prev;

      const expandedRows: SizeVariantRowData[] = splitColours.map((clr, cIdx) => {
        const clrCode = skuColourPart(clr);
        const rowNumber = (index + cIdx + 1).toString().padStart(2, "0");
        return {
          ...currentRow,
          id: cIdx === 0 ? currentRow.id : undefined, // keep existing id on 1st row if editing
          colour: clr,
          sku: `SKU-${currentRow.size.toUpperCase()}-${clrCode}-${rowNumber}`,
          barcode: cIdx === 0 ? currentRow.barcode : "", // keep barcode on 1st, clear on splits
          isManual: true,
        };
      });

      const copy = [...prev];
      copy.splice(index, 1, ...expandedRows);
      return copy;
    });
  }

  function applyQuickFillToAll() {
    setTableRows((prev) =>
      prev.map((r) => ({
        ...r,
        cost: costPrice.trim() ? costPrice : r.cost,
        mrp: mrpPrice.trim() ? mrpPrice : r.mrp,
        price: sellingPrice.trim() ? sellingPrice : r.price,
        openingQty: !r.id && fillQty.trim() ? fillQty : r.openingQty,
      }))
    );
  }

  // Intercept Enter key on barcode gun scan so it doesn't submit form, and auto-focuses next row
  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const nextRef = barcodeInputRefs.current[rowIndex + 1];
      if (nextRef) {
        nextRef.focus();
        nextRef.select();
      }
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const taxData = readTaxRate(formData);
    const taxTreatment = (formData.get("taxTreatment") as string) || defaultTaxTreatment;
    const taxExemptionRef = (formData.get("taxExemptionRef") as string) || null;
    const isProductActive = formData.get("isActive") === "on";

    // 1. Client-side duplicate SKU & Barcode check across the table
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    // Auto-generate SKUs for any row that doesn't have one before submitting
    for (let i = 0; i < tableRows.length; i++) {
      const r = tableRows[i]!;
      if (!r.sku.trim()) {
        const clrPart = skuColourPart(r.colour);
        r.sku = `SKU-${r.size.toUpperCase()}-${clrPart}-${(i + 1).toString().padStart(2, "0")}`;
      }
      if (r.sku.trim()) {
        const skuUpper = r.sku.trim().toUpperCase();
        if (seenSkus.has(skuUpper)) {
          // If collision occurs, make it unique
          r.sku = `${r.sku}-${Date.now().toString().slice(-4)}`;
        }
        seenSkus.add(r.sku.trim().toUpperCase());
      }
      if (r.barcode.trim()) {
        const bc = r.barcode.trim();
        if (seenBarcodes.has(bc)) {
          setError(`Duplicate Barcode "${r.barcode}" found in row ${i + 1}. Each variant must have a unique barcode.`);
          setSaving(false);
          return;
        }
        seenBarcodes.add(bc);
      }
    }

    const payload: Record<string, unknown> = {
      name: formData.get("name") as string,
      category: (formData.get("category") as string) || null,
      brand: (formData.get("brand") as string) || null,
      baseUomId: formData.get("baseUomId") as string,
      isActive: isProductActive,
      imageUrl: imageUrl,
    };

    if (tableRows.length > 0) {
      payload.variants = tableRows.map((r, i) => {
        const sCost = r.cost?.trim() ? Math.round(parseFloat(r.cost) * 100) : null;
        const sPrice = r.price?.trim() ? Math.round(parseFloat(r.price) * 100) : 0;
        const sMrp = r.mrp?.trim() ? Math.round(parseFloat(r.mrp) * 100) : null;
        const openQty = r.openingQty?.trim() ? Math.max(0, parseInt(r.openingQty, 10)) : 0;

        // Auto-generate SKU if omitted so database variant creation always gets a valid SKU
        const clrPart = skuColourPart(r.colour);
        const fallbackSku = `SKU-${(r.size || "STD").toUpperCase()}-${clrPart}-${(i + 1).toString().padStart(2, "0")}`;
        const finalSku = r.sku.trim() || fallbackSku;

        return {
          id: r.id,
          sku: finalSku,
          barcode: r.barcode.trim() || null,
          size: r.size.trim() || null,
          colour: r.colour.trim() || null,
          costPriceMinor: sCost,
          priceMinor: sPrice,
          mrpMinor: sMrp,
          taxRateBp: taxData.taxRateBp,
          taxRateMode: taxData.taxRateMode,
          taxTreatment,
          taxExemptionRef,
          openingQty: openQty,
          isActive: r.isActive,
        };
      });
    } else {
      // Single variant mode fallback
      payload.variant = {
        sku: null,
        barcode: null,
        size: "Free Size",
        colour: colourInput.trim() || null,
        costPriceMinor: costPrice ? Math.round(parseFloat(costPrice) * 100) : null,
        priceMinor: sellingPrice ? Math.round(parseFloat(sellingPrice) * 100) : 0,
        mrpMinor: mrpPrice ? Math.round(parseFloat(mrpPrice) * 100) : null,
        taxRateBp: taxData.taxRateBp,
        taxRateMode: taxData.taxRateMode,
        taxTreatment,
        taxExemptionRef,
        openingQty: fillQty.trim() ? Math.max(0, parseInt(fillQty, 10)) : 0,
        isActive: true,
      };
    }

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

    try {
      const url = initialData ? `/api/v1/catalog/products/${initialData.id}` : "/api/v1/catalog/products";
      const res = await fetch(url, {
        method: initialData ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const serverMsg = data?.error?.message || data?.message || "Failed to save product";
        setError(serverMsg);
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
    } catch {
      setError("An unexpected error occurred. Check connection.");
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="w-full space-y-8" noValidate>
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700 border border-red-200 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900 border-b pb-2">Product Master Details</h3>

          <div className="flex flex-col sm:flex-row gap-6">
            {/* Image Upload Area */}
            <div className="shrink-0">
              <label className="block text-sm font-medium text-slate-900 mb-1">Image</label>
              <div className="relative group w-32 h-32 sm:w-40 sm:h-40 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden transition-colors hover:border-blue-400 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2">
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
                  <div className="flex flex-col items-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mb-1" />
                    <span className="text-xs font-medium">Uploading...</span>
                  </div>
                ) : imageUrl ? (
                  <div className="relative w-full h-full">
                    <img src={imageUrl} alt="Product preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="absolute top-1.5 right-1.5 p-1 bg-white/80 rounded-full text-slate-600 hover:text-red-600 hover:bg-white z-20 transition-colors shadow-sm"
                      aria-label="Remove image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-slate-400 group-hover:text-slate-500 text-center px-2">
                    <UploadCloud className="w-8 h-8 mb-1 text-slate-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-xs font-medium">Upload Image</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">JPEG, PNG, WebP</span>
                  </div>
                )}
              </div>
              {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
            </div>

            {/* Basic Info Fields */}
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
                  placeholder="e.g. Cotton Polo T-Shirt, Slim Fit Denim"
                  aria-invalid={!!fieldErrors["name"]}
                  aria-describedby={fieldErrors["name"] ? "name-error" : undefined}
                  className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    fieldErrors["name"] ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-primary"
                  }`}
                />
                {fieldErrors["name"] && <p id="name-error" className="mt-1 text-xs text-red-600">{fieldErrors["name"]}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="brand" className="block text-sm font-medium text-slate-900">
                    Brand
                  </label>
                  <input
                    id="brand"
                    name="brand"
                    type="text"
                    defaultValue={initialData?.brand ?? ""}
                    placeholder="e.g. Allen Solly, Peter England"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-slate-900">
                    Category
                  </label>
                  <input
                    id="category"
                    name="category"
                    type="text"
                    defaultValue={initialData?.category ?? ""}
                    placeholder="e.g. Men's Wear, T-Shirts, Jeans"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="baseUomId" className="block text-sm font-medium text-slate-900">
                    Base Unit of Measure <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="baseUomId"
                    name="baseUomId"
                    required
                    defaultValue={initialData?.baseUomId ?? (uoms[0]?.id || "")}
                    aria-invalid={!!fieldErrors["baseUomId"]}
                    aria-describedby={fieldErrors["baseUomId"] ? "baseUomId-error" : undefined}
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {uoms.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </select>
                  {fieldErrors["baseUomId"] && (
                    <p id="baseUomId-error" className="mt-1 text-xs text-red-600">{fieldErrors["baseUomId"]}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="isActive"
                    name="isActive"
                    type="checkbox"
                    defaultChecked={initialData?.isActive ?? true}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <label htmlFor="isActive" className="text-sm font-medium text-slate-900">
                    Product is active for billing &amp; sales
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* GST / TAX CLASSIFICATION CONTROLS */}
        <div className="space-y-2">
          <GstTaxFields
            taxTreatment={defaultTaxTreatment}
            taxRateMode={defaultTaxRateMode}
            taxRateBp={defaultTaxRateBp}
          />
        </div>

        {/* GARMENT SIZES & VARIANTS TABLE */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between border-b pb-2 gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Garment Sizes, Rates &amp; Barcodes</h3>
              <p className="text-xs text-slate-500">
                Manage each size&apos;s selling rate, MRP, SKU, and barcode. Scanner gun auto-advances to the next row on Enter.
              </p>
            </div>
            <button
              type="button"
              onClick={addNewVariantRow}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-primary hover:bg-sky-100 transition-colors shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              Add Size / Variant
            </button>
          </div>

          {/* Quick presets (only in Create mode or when generating new sizes) */}
          {isCreate && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">1. Select Garment Sizes:</label>
                <div className="flex flex-wrap gap-2">
                  {STANDARD_GARMENT_SIZES.map((sz) => {
                    const isSelected = parsedSizes.includes(sz.toUpperCase());
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => togglePresetSize(sz)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                          isSelected
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                        }`}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    2. Select Garment Colours:
                  </label>
                  {parsedSizes.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500 font-medium">Add colours to:</span>
                      <button
                        type="button"
                        onClick={clearAllSizeFilters}
                        className={`rounded px-2 py-0.5 font-bold transition-all ${
                          activeSizeFilters.length === 0
                            ? "bg-primary text-white shadow-xs"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        All Sizes
                      </button>
                      <button
                        type="button"
                        onClick={selectAllSizeFilters}
                        className={`rounded px-2 py-0.5 font-bold transition-all ${
                          activeSizeFilters.length === parsedSizes.length
                            ? "bg-primary text-white shadow-xs"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
                            className={`rounded px-2 py-0.5 font-bold transition-all border ${
                              isSelected
                                ? "bg-primary text-white border-primary shadow-xs ring-1 ring-primary"
                                : "bg-sky-50 text-primary hover:bg-sky-100 border-sky-200"
                            }`}
                          >
                            Size {sz} {isSelected && "✓"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {activeSizeFilters.length > 0 && (
                  <div className="mb-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-950 flex flex-wrap items-center justify-between gap-2 border border-sky-200">
                    <span>
                      🎯 <strong>Targeting {activeSizeFilters.length === 1 ? `Size ${activeSizeFilters[0]}` : `Sizes: ${activeSizeFilters.join(", ")}`}:</strong> Click colour pills below to assign or remove colours for these sizes only.
                    </span>
                    <button
                      type="button"
                      onClick={clearAllSizeFilters}
                      className="font-bold underline text-primary hover:text-primary-hover ml-2"
                    >
                      Reset to All Sizes
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {STANDARD_GARMENT_COLOURS.map((clr) => {
                    const clrUpper = clr.name.toUpperCase();
                    const isSelected =
                      activeSizeFilters.length > 0
                        ? activeSizeFilters.every((sz) =>
                            tableRows.some(
                              (r) =>
                                r.size.trim().toUpperCase() === sz &&
                                r.colour.trim().toUpperCase() === clrUpper
                            )
                          )
                        : tableRows.some(
                            (r) => r.colour.trim().toUpperCase() === clrUpper
                          ) || parsedColours.includes(clrUpper);
                    return (
                      <button
                        key={clr.name}
                        type="button"
                        onClick={() => togglePresetColour(clr.name)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                          isSelected
                            ? "bg-primary text-white border-primary shadow-sm ring-1 ring-primary"
                            : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-slate-300"
                          style={{ backgroundColor: clr.hex }}
                        />
                        {clr.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label htmlFor="size" className="block text-xs font-medium text-slate-700">
                    Or type sizes (comma separated):
                  </label>
                  <input
                    id="size"
                    name="size"
                    type="text"
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    placeholder="e.g. S, M, L, XL, XXL"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="colour" className="block text-xs font-medium text-slate-700">
                    Or type colours (comma separated):
                  </label>
                  <input
                    id="colour"
                    name="colour"
                    type="text"
                    value={colourInput}
                    onChange={(e) => setColourInput(e.target.value)}
                    placeholder="e.g. Black, Navy, Olive Green"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TABLE CONTAINER */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-5 space-y-4 w-full shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  Variant Matrix ({tableRows.length} {tableRows.length === 1 ? "variant" : "variants"})
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong>Setup 2 (BarTender):</strong> Scan barcode gun into the box — auto-advances on Enter.
                  <span className="mx-2 text-slate-300">|</span>
                  <strong>Setup 1 (POS Tag):</strong> Leave blank or click &ldquo;Auto&rdquo; for 8-digit Code-128 stickers.
                </p>
              </div>

              {/* Quick Fill Helper */}
              <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-indigo-100 shadow-2xs">
                <span className="text-xs text-slate-600 font-semibold">Quick Fill:</span>
                <input
                  type="number"
                  placeholder="Qty"
                  value={fillQty}
                  onChange={(e) => setFillQty(e.target.value)}
                  className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900"
                />
                <input
                  type="number"
                  placeholder="Cost ₹"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  placeholder="MRP ₹"
                  value={mrpPrice}
                  onChange={(e) => setMrpPrice(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  placeholder="Sell ₹"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-900 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={applyQuickFillToAll}
                  title="Apply these rates & qty to all variant rows"
                  className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-hover transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  Apply All
                </button>
              </div>
            </div>

            <div className="w-full rounded-xl border border-slate-200 bg-white shadow-xs overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-slate-700 font-semibold">
                    <th className="py-3 px-3 w-16">Size</th>
                    <th className="py-3 px-2 w-28">Colour</th>
                    <th className="py-3 px-2 w-48">
                      <div className="flex items-center justify-between">
                        <span>SKU</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTableRows((prev) =>
                              prev.map((r, i) => {
                                const clrCode = skuColourPart(r.colour);
                                const szCode = (r.size || "STD").toUpperCase();
                                return {
                                  ...r,
                                  sku: `SKU-${szCode}-${clrCode}-${(i + 1).toString().padStart(2, "0")}`,
                                };
                              })
                            );
                          }}
                          title="Generate unique SKUs for all rows"
                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary-hover font-bold ml-1 hover:underline cursor-pointer"
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          Auto All
                        </button>
                      </div>
                    </th>
                    <th className="py-3 px-2 w-20">{isCreate ? "Opening Qty" : "Qty / Stock"}</th>
                    <th className="py-3 px-2 w-28">Cost (₹)</th>
                    <th className="py-3 px-2 w-28">MRP (₹)</th>
                    <th className="py-3 px-2 w-28">Selling (₹) *</th>
                    <th className="py-3 px-2 w-20 text-center">Profit / Margin</th>
                    <th className="py-3 px-3 min-w-[210px]">Barcode (Scan with gun or Auto)</th>
                    <th className="py-3 px-2 w-14 text-center">Active</th>
                    <th className="py-3 px-2 w-16 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableRows.map((row, idx) => {
                    const c = parseFloat(row.cost);
                    const p = parseFloat(row.price);
                    const hasMargin = !isNaN(c) && !isNaN(p) && c > 0 && p > 0;
                    const profit = hasMargin ? (p - c).toFixed(2) : null;
                    const marginPercent = hasMargin ? (((p - c) / p) * 100).toFixed(0) : null;

                    return (
                      <tr key={row.id || idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={row.size}
                            onChange={(e) => updateRow(idx, { size: e.target.value })}
                            placeholder="Size"
                            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900 uppercase"
                          />
                        </td>
                        <td className="py-2.5 px-2">
                          <input
                            ref={(el) => {
                              colourInputRefs.current[idx] = el;
                            }}
                            type="text"
                            value={row.colour}
                            onChange={(e) => updateRow(idx, { colour: e.target.value })}
                            onBlur={(e) => handleColourBlurOrEnter(idx, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && row.colour.includes(",")) {
                                e.preventDefault();
                                handleColourBlurOrEnter(idx, row.colour);
                              }
                            }}
                            placeholder="Colour (e.g. Red, Blue)"
                            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-1 min-w-[170px]">
                            <input
                              type="text"
                              value={row.sku}
                              onChange={(e) => updateRow(idx, { sku: e.target.value })}
                              placeholder={`SKU-${(row.size || "STD").toUpperCase()}-${skuColourPart(row.colour)}-${(idx + 1).toString().padStart(2, "0")}`}
                              className="w-full rounded-md border border-slate-300 bg-slate-50/40 px-2.5 py-1 text-xs font-mono uppercase focus:border-primary focus:bg-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const clrCode = skuColourPart(row.colour);
                                const rowNum = (idx + 1).toString().padStart(2, "0");
                                const genSku = `SKU-${(row.size || "STD").toUpperCase()}-${clrCode}-${rowNum}`;
                                updateRow(idx, { sku: genSku });
                              }}
                              title="Auto-generate SKU with Colour"
                              className="shrink-0 p-1 text-slate-400 hover:text-primary rounded hover:bg-slate-100"
                            >
                              <Sparkles className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          {row.id ? (
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 text-xs">
                                {row.stock != null ? `${row.stock} pcs` : "0 pcs"}
                              </span>
                              <span className="text-[10px] text-slate-400">Current</span>
                            </div>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              value={row.openingQty}
                              onChange={(e) => updateRow(idx, { openingQty: e.target.value })}
                              placeholder="0"
                              className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs tabular-nums font-semibold text-slate-900 focus:border-primary focus:outline-none"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-400 text-xs">₹</span>
                            <input
                              type="number"
                              step="0.01"
                              value={row.cost}
                              onChange={(e) => updateRow(idx, { cost: e.target.value })}
                              placeholder="0.00"
                              className="w-28 rounded-md border border-slate-300 pl-5 pr-2 py-1 text-xs text-right tabular-nums focus:border-primary focus:outline-none"
                            />
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-400 text-xs">₹</span>
                            <input
                              type="number"
                              step="0.01"
                              value={row.mrp}
                              onChange={(e) => updateRow(idx, { mrp: e.target.value })}
                              placeholder="0.00"
                              className="w-28 rounded-md border border-slate-300 pl-5 pr-2 py-1 text-xs text-right tabular-nums focus:border-primary focus:outline-none"
                            />
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-400 text-xs">₹</span>
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={row.price}
                              onChange={(e) => updateRow(idx, { price: e.target.value })}
                              placeholder="0.00"
                              className="w-28 rounded-md border border-slate-300 pl-5 pr-2 py-1 text-xs font-bold text-slate-900 text-right tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {hasMargin ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="font-bold text-slate-900 text-xs">₹{profit}</span>
                              <span className="rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-bold text-emerald-800">
                                {marginPercent}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <div className="relative flex-1 min-w-[120px]">
                              <input
                                ref={(el) => {
                                  barcodeInputRefs.current[idx] = el;
                                }}
                                type="text"
                                value={row.barcode}
                                onChange={(e) => updateRow(idx, { barcode: e.target.value })}
                                onKeyDown={(e) => handleBarcodeKeyDown(e, idx)}
                                placeholder={row.barcode ? row.barcode : "Scan gun / Auto"}
                                className={`w-full rounded-md border pl-2 pr-6 py-1 text-xs font-mono focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none ${
                                  row.barcode
                                    ? "border-emerald-300 bg-emerald-50/40 font-semibold text-emerald-950"
                                    : "border-slate-300 bg-white"
                                }`}
                              />
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-slate-400">
                                <ScanLine className="h-3 w-3" />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const rand = `20${Math.floor(100000 + Math.random() * 900000)}`;
                                updateRow(idx, { barcode: rand });
                              }}
                              title="Auto-generate 8-digit POS barcode (Setup 1)"
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-300 hover:text-primary transition-colors shadow-2xs"
                            >
                              <Sparkles className="h-3 w-3 text-primary" />
                              Auto
                            </button>
                            <button
                              type="button"
                              onClick={() => setCameraScannerForIndex(idx)}
                              title="Scan using device camera"
                              className="inline-flex shrink-0 items-center rounded-md border border-slate-200 bg-slate-50 p-1 text-slate-700 hover:bg-sky-50 hover:border-sky-300 hover:text-primary transition-colors shadow-2xs"
                            >
                              <Camera className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {row.barcode && (
                            <span className="mt-0.5 block text-[10px] text-emerald-700 font-medium">
                              Saved tag: {row.barcode}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.isActive}
                            onChange={(e) => updateRow(idx, { isActive: e.target.checked })}
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => addColourForSize(idx)}
                              title={`Add another colour for size ${row.size}`}
                              className="p-1 rounded text-primary hover:bg-sky-100 hover:text-primary-hover transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeVariantRow(idx)}
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

            <div className="pt-1">
              <button
                type="button"
                onClick={addNewVariantRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-primary hover:bg-sky-50 hover:border-sky-400 transition-colors shadow-2xs"
              >
                <Plus className="h-4 w-4" />
                + Add Custom Variant Row
              </button>
            </div>
          </div>
        </div>

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

      {/* Camera Barcode Scanner Modal */}
      {cameraScannerForIndex !== null && (
        <CameraBarcodeScannerModal
          isOpen={cameraScannerForIndex !== null}
          onClose={() => setCameraScannerForIndex(null)}
          onScan={(scannedBarcode) => {
            updateRow(cameraScannerForIndex, { barcode: scannedBarcode });
            setCameraScannerForIndex(null);
          }}
        />
      )}
    </>
  );
}
