"use client";

import { useState, useMemo } from "react";
import { Barcode, Printer, X, Plus, Minus } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { BarcodeSvg } from "@/client/hardware/BarcodeSvg";

export interface PrintableVariantItem {
  id: string;
  sku: string;
  barcode: string | null;
  productName: string;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor?: number | null;
  /** Quantity to print. Default: 1 (or purchase receipt quantity) */
  quantity?: number;
}

export function BarcodeLabelModal(props: {
  isOpen: boolean;
  onClose: () => void;
  variants: PrintableVariantItem[];
  storeName?: string;
  title?: string;
}) {
  // Store printing quantities per variant
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const v of props.variants) {
      init[v.id] = v.quantity && v.quantity > 0 ? v.quantity : 1;
    }
    return init;
  });

  const [includeStoreName, setIncludeStoreName] = useState(true);
  const [includeMrp, setIncludeMrp] = useState(true);
  const [labelSize, setLabelSize] = useState<"50x25" | "38x25">("50x25");

  if (!props.isOpen || props.variants.length === 0) return null;

  function updateQty(id: string, qty: number) {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, Math.min(500, qty)),
    }));
  }

  function setAllQty(qty: number) {
    const next: Record<string, number> = {};
    for (const v of props.variants) {
      next[v.id] = qty;
    }
    setQuantities(next);
  }

  // Flattened array of labels to render
  const flatLabels = useMemo(() => {
    const labels: PrintableVariantItem[] = [];
    for (const v of props.variants) {
      const count = quantities[v.id] ?? 0;
      for (let i = 0; i < count; i++) {
        labels.push(v);
      }
    }
    return labels;
  }, [props.variants, quantities]);

  function handlePrint() {
    window.print();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm print:p-0 print:bg-white print:static"
    >
      <div className="amb-pop-in relative flex max-h-[94vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl print:max-h-none print:w-full print:border-none print:shadow-none">
        {/* Header - Screen Only */}
        <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Barcode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {props.title || "Garment Thermal Barcode Label Generator"}
              </h3>
              <p className="text-xs text-slate-500">
                Print high-density thermal barcode stickers directly to your TSC, Zebra, or Xprinter machine.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar & Item Quantity Settings - Screen Only */}
        <div className="border-b border-slate-100 bg-slate-50/70 p-4 print:hidden space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-slate-700">
                <span>Sticker Roll Size:</span>
                <select
                  value={labelSize}
                  onChange={(e) => setLabelSize(e.target.value as "50x25" | "38x25")}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="50x25">50mm × 25mm (Standard Garment Tag)</option>
                  <option value="38x25">38mm × 25mm (Compact 2-Up Roll)</option>
                </select>
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={includeStoreName}
                  onChange={(e) => setIncludeStoreName(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Store Header</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={includeMrp}
                  onChange={(e) => setIncludeMrp(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>MRP &amp; Selling Price</span>
              </label>
            </div>

            {/* Print Trigger */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600">
                Total: <strong className="text-indigo-600">{flatLabels.length}</strong> stickers
              </span>
              <button
                type="button"
                onClick={handlePrint}
                disabled={flatLabels.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span>Print All Labels</span>
              </button>
            </div>
          </div>

          {/* Per-item quantity controls */}
          <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
            <div className="flex items-center justify-between px-2 pb-1.5 border-b border-slate-100 text-[11px] font-semibold text-slate-500">
              <span>Item / Variant</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAllQty(1)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Set all to 1
                </button>
                <button
                  type="button"
                  onClick={() => setAllQty(5)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Set all to 5
                </button>
                <span>Stickers to Print</span>
              </div>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {props.variants.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-1.5 px-2">
                  <div className="truncate pr-4">
                    <span className="font-semibold text-slate-900">{v.productName}</span>{" "}
                    <span className="text-slate-500">
                      {[v.size ? `Size: ${v.size}` : null, v.colour].filter(Boolean).join(" · ") || v.sku}
                    </span>
                    <span className="ml-2 font-mono text-[10px] text-slate-400">
                      [{v.barcode || v.sku}]
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQty(v.id, (quantities[v.id] ?? 0) - 1)}
                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={quantities[v.id] ?? 0}
                      onChange={(e) => updateQty(v.id, parseInt(e.target.value, 10) || 0)}
                      className="h-6 w-14 rounded border border-slate-300 text-center font-bold text-slate-900 focus:border-indigo-500 focus:outline-none text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => updateQty(v.id, (quantities[v.id] ?? 0) + 1)}
                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Printable Stickers Sheet Preview */}
        <div className="flex-1 overflow-y-auto bg-slate-100/70 p-4 sm:p-6 print:overflow-visible print:bg-white print:p-0">
          <div className="mx-auto max-w-4xl print:max-w-none">
            {flatLabels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                No stickers selected. Increase the quantity above to preview and print.
              </div>
            ) : (
              <div
                className={`grid gap-3 print:gap-1.5 ${
                  labelSize === "50x25"
                    ? "grid-cols-2 sm:grid-cols-3 print:grid-cols-2"
                    : "grid-cols-2 sm:grid-cols-3 print:grid-cols-2"
                }`}
              >
                {flatLabels.map((v, idx) => {
                  const barcodeString = v.barcode || v.sku;
                  return (
                    <div
                      key={`${v.id}-${idx}`}
                      className="garment-barcode-sticker relative flex flex-col justify-between overflow-hidden rounded-lg border border-slate-300 bg-white p-2 text-center shadow-xs print:border-black print:shadow-none"
                      style={{
                        width: labelSize === "50x25" ? "188px" : "150px",
                        height: "105px",
                        pageBreakInside: "avoid",
                        breakInside: "avoid",
                        margin: "0 auto",
                      }}
                    >
                      {/* Shop Header */}
                      {includeStoreName && (
                        <div className="truncate text-[10px] font-black uppercase tracking-wider text-black border-b border-black/40 pb-0.5 leading-tight">
                          {props.storeName || "GARMENT FASHION"}
                        </div>
                      )}

                      {/* Product Name & Variant Details */}
                      <div className="my-0.5 leading-tight">
                        <div className="line-clamp-1 text-[11px] font-bold text-black uppercase">
                          {v.productName}
                        </div>
                        <div className="truncate text-[9px] font-semibold text-black">
                          {[v.size ? `SIZE: ${v.size}` : null, v.colour].filter(Boolean).join(" | ")}
                        </div>
                      </div>

                      {/* Scannable Code-128 Barcode */}
                      <div className="flex flex-col items-center justify-center my-0.5">
                        <BarcodeSvg
                          value={barcodeString}
                          height={28}
                          barWidth={1.4}
                          className="h-6 w-full max-w-[150px] text-black"
                        />
                        <div className="font-mono text-[9px] font-extrabold tracking-widest text-black mt-0.5">
                          {barcodeString}
                        </div>
                      </div>

                      {/* Price & MRP Row */}
                      {includeMrp && (
                        <div className="flex items-center justify-between border-t border-black/40 pt-0.5 text-[10px] font-bold leading-tight text-black">
                          {v.mrpMinor != null && v.mrpMinor > v.priceMinor ? (
                            <>
                              <span className="text-[8px] font-medium text-black line-through">
                                MRP ₹{(v.mrpMinor / 100).toFixed(0)}
                              </span>
                              <span className="text-[10px] font-black text-black">
                                ₹{(v.priceMinor / 100).toFixed(0)}
                              </span>
                            </>
                          ) : (
                            <div className="w-full text-center text-[10px] font-black text-black">
                              MRP ₹{(v.priceMinor / 100).toFixed(0)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions - Screen Only */}
        <div className="flex items-center justify-between border-t border-slate-100 p-4 print:hidden">
          <span className="text-xs text-slate-500">
            Thermal Label Print Setup (Auto 2-up layout on 50x25mm / 38x25mm rolls)
          </span>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
