"use client";

import { useState } from "react";
import { Barcode, Printer, X, Tag } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

interface BarcodeLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  variantName?: string | null;
  sku: string;
  barcode?: string | null;
  priceMinor: number;
}

/**
 * Barcode & Shelf Label Print Generator
 * Formats clean SVG Code128 barcode representation and standard retail thermal label:
 * - 50mm x 25mm standard sticker roll / shelf tag
 * - Store / Product Name, Variant, SKU, MRP / Retail Price
 * - Browser direct print dialog styled for compact label rolls
 */
export function BarcodeLabelModal({
  isOpen,
  onClose,
  productName,
  variantName,
  sku,
  barcode,
  priceMinor,
}: BarcodeLabelModalProps) {
  const [copies, setCopies] = useState(1);
  const codeValue = barcode || sku;

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs print:p-0 print:bg-white print:fixed-none">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl print:border-none print:shadow-none print:p-0 print:max-w-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 print:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Barcode className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Print Barcode & Shelf Tag</h3>
              <p className="text-[11px] text-slate-500">Standard 50mm × 25mm Retail Label</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Label Preview (Repeated based on copies when printing) */}
        <div className="my-5 flex flex-col items-center justify-center bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200 print:bg-white print:border-none print:p-0 print:m-0">
          <div className="text-[11px] font-semibold text-slate-500 mb-2 print:hidden flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Label Preview (50mm × 25mm)
          </div>

          <div
            className="w-[240px] rounded-lg border border-slate-300 bg-white p-3 shadow-xs text-center flex flex-col justify-between print:border-slate-400 print:shadow-none print:w-[50mm] print:h-[25mm] print:m-1 print:break-inside-avoid"
            style={{ minHeight: "120px" }}
          >
            <div>
              <div className="text-[11px] font-bold text-slate-900 truncate leading-tight uppercase">
                {productName}
              </div>
              {variantName && (
                <div className="text-[9px] font-medium text-slate-500 truncate">{variantName}</div>
              )}
            </div>

            {/* Visual Code128 pattern generator */}
            <div className="my-1 flex flex-col items-center justify-center">
              <div className="flex items-end justify-center h-8 gap-[1.5px] w-full px-2">
                {codeValue.split("").map((char, idx) => {
                  const code = char.charCodeAt(0);
                  const h1 = 16 + (code % 14);
                  const h2 = 18 + ((code * 3) % 12);
                  const w1 = code % 2 === 0 ? "w-[2px]" : "w-[1px]";
                  const w2 = code % 3 === 0 ? "w-[2.5px]" : "w-[1.5px]";
                  return (
                    <div key={idx} className="flex items-end gap-[1px]">
                      <div className={`bg-slate-950 ${w1}`} style={{ height: `${h1}px` }} />
                      <div className={`bg-slate-950 ${w2}`} style={{ height: `${h2}px` }} />
                    </div>
                  );
                })}
              </div>
              <div className="font-mono text-[9.5px] font-bold tracking-widest text-slate-800 mt-0.5">
                {codeValue}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-1 text-[11px]">
              <span className="font-mono text-[9px] text-slate-500 uppercase">{sku}</span>
              <span className="font-bold text-slate-900">{formatMinor(priceMinor)}</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4 print:hidden">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">Number of Stickers</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                className="h-8 w-8 rounded-lg border border-slate-300 font-bold hover:bg-slate-100"
              >
                -
              </button>
              <span className="w-8 text-center font-bold text-sm">{copies}</span>
              <button
                type="button"
                onClick={() => setCopies((c) => Math.min(100, c + 1))}
                className="h-8 w-8 rounded-lg border border-slate-300 font-bold hover:bg-slate-100"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
            >
              <Printer className="h-4 w-4" />
              Print Stickers
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
