"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Camera, ScanLine, Sparkles, TrendingUp } from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { GstTaxFields, readTaxRate } from "../GstTaxFields";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";

export function VariantForm(props: {
  productId: string;
  variant?: {
    id: string;
    sku: string;
    barcode: string | null;
    size: string | null;
    colour: string | null;
    costPriceMinor?: number | null;
    priceMinor: number | null;
    mrpMinor: number | null;
    taxRateBp: number;
    taxTreatment: import("@prisma/client").GstTaxTreatment;
    taxExemptionRef: string | null;
    taxRateMode?: string;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const v = props.variant;

  // SKU & Barcode state
  const [skuValue, setSkuValue] = useState(v?.sku ?? "");
  const [barcodeValue, setBarcodeValue] = useState(v?.barcode ?? "");
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);

  // Cost, Selling Price, MRP state
  const [costPrice, setCostPrice] = useState<string>(
    v?.costPriceMinor != null ? (v.costPriceMinor / 100).toFixed(2) : ""
  );
  const [sellingPrice, setSellingPrice] = useState<string>(
    v?.priceMinor != null ? (v.priceMinor / 100).toFixed(2) : ""
  );
  const [mrpPrice, setMrpPrice] = useState<string>(
    v?.mrpMinor != null ? (v.mrpMinor / 100).toFixed(2) : ""
  );

  // Profit & Margin calculations
  const marginCalculation = useMemo(() => {
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

  function generateAutoSku() {
    const generated = `SKU-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    setSkuValue(generated);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const priceStr = sellingPrice;
    const costStr = costPrice;
    const mrpStr = mrpPrice;

    const payload = {
      sku: skuValue.trim() || null,
      barcode: barcodeValue.trim() || null,
      size: (formData.get("size") as string) || null,
      colour: (formData.get("colour") as string) || null,
      costPriceMinor: costStr ? Math.round(parseFloat(costStr) * 100) : null,
      priceMinor: priceStr ? Math.round(parseFloat(priceStr) * 100) : 0,
      mrpMinor: mrpStr ? Math.round(parseFloat(mrpStr) * 100) : null,
      ...readTaxRate(formData),
      taxTreatment: formData.get("taxTreatment") as string,
      taxExemptionRef: (formData.get("taxExemptionRef") as string) || null,
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
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* SKU Field with Auto-Generate */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="sku" className="block text-sm font-medium text-slate-700">
                SKU <span className="text-xs font-normal text-slate-500">(Unique identifier)</span>
              </label>
              <button
                type="button"
                onClick={generateAutoSku}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                <Sparkles className="h-3 w-3" />
                Auto-generate
              </button>
            </div>
            <input
              id="sku"
              name="sku"
              value={skuValue}
              onChange={(e) => setSkuValue(e.target.value)}
              placeholder="Auto-generated if left blank"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Barcode: scanned, typed, or left blank for the next in-store code */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="barcode" className="block text-sm font-medium text-slate-700">
                Barcode <span className="text-xs font-normal text-slate-500">(Thermal Code-128 / EAN)</span>
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCameraScannerOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Camera
                </button>
              </div>
            </div>
            <div className="relative mt-1">
              <input
                id="barcode"
                name="barcode"
                value={barcodeValue}
                onChange={(e) => setBarcodeValue(e.target.value)}
                placeholder="Scan the tag, type it, or leave blank to create one"
                className="block w-full rounded-md border border-slate-300 pl-3 pr-10 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                <ScanLine className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Leave blank to auto-create a compact 8-digit barcode for thermal sticker printing.
            </p>
          </div>

          {/* Cost Price per piece */}
          <div>
            <label htmlFor="costPrice" className="block text-sm font-medium text-slate-700">
              Cost per piece (₹) <span className="text-xs font-normal text-slate-500">(Purchase Cost)</span>
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">₹</span>
              <input
                id="costPrice"
                name="costPrice"
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0.00"
                className="block w-full rounded-md border border-slate-300 pl-7 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">What you paid per unit to buy or produce this item.</p>
          </div>

          {/* Selling Price */}
          <div>
            <label htmlFor="priceMinor" className="block text-sm font-medium text-slate-700">
              Selling Price (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">₹</span>
              <input
                id="priceMinor"
                name="priceMinor"
                type="number"
                step="0.01"
                min="0"
                required
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="0.00"
                className="block w-full rounded-md border border-slate-300 pl-7 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Live Profit & Margin Widget */}
          {marginCalculation && (
            <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-emerald-950">Calculated Profit &amp; Margin:</span>
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-slate-500">Profit / Piece:</span>{" "}
                    <strong className="text-slate-900 font-bold">₹{marginCalculation.profit}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Gross Margin:</span>{" "}
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 font-bold text-white">
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

          {/* MRP (Printed Price) */}
          <div>
            <label htmlFor="mrpMinor" className="block text-sm font-medium text-slate-700">
              MRP (₹) <span className="text-xs font-normal text-slate-500">(Printed Price)</span>
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">₹</span>
              <input
                id="mrpMinor"
                name="mrpMinor"
                type="number"
                step="0.01"
                min="0"
                value={mrpPrice}
                onChange={(e) => setMrpPrice(e.target.value)}
                placeholder="0.00"
                className="block w-full rounded-md border border-slate-300 pl-7 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Size */}
          <div>
            <label htmlFor="size" className="block text-sm font-medium text-slate-700">
              Size
            </label>
            <input
              id="size"
              name="size"
              defaultValue={v?.size ?? ""}
              placeholder="e.g. M, L, XL, 32, Free Size"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Colour */}
          <div>
            <label htmlFor="colour" className="block text-sm font-medium text-slate-700">
              Colour
            </label>
            <input
              id="colour"
              name="colour"
              defaultValue={v?.colour ?? ""}
              placeholder="e.g. Navy Blue, White, Black"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* GST Tax Fields with Default to NON_GST */}
        <GstTaxFields
          taxRateBp={v?.taxRateBp}
          taxTreatment={v?.taxTreatment ?? "NON_GST"}
          taxExemptionRef={v?.taxExemptionRef}
          taxRateMode={v?.taxRateMode}
        />

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

      {/* Camera Barcode Scanner Modal */}
      {cameraScannerOpen && (
        <CameraBarcodeScannerModal
          isOpen={cameraScannerOpen}
          onClose={() => setCameraScannerOpen(false)}
          onScan={(scannedBarcode) => {
            setBarcodeValue(scannedBarcode);
            setCameraScannerOpen(false);
          }}
        />
      )}
    </>
  );
}
