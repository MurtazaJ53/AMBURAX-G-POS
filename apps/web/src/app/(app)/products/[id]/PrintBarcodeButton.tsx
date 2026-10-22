"use client";

import { useState } from "react";
import { Barcode, Printer } from "lucide-react";
import { BarcodeLabelModal, type PrintableVariantItem } from "./BarcodeLabelModal";

export function PrintBarcodeButton(props: {
  variants: PrintableVariantItem[];
  storeName?: string;
  buttonLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (props.variants.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          props.className ||
          "flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        }
      >
        <Printer className="h-4 w-4 text-slate-600" />
        <span>{props.buttonLabel || "Print Barcodes"}</span>
      </button>

      {open && (
        <BarcodeLabelModal
          isOpen={open}
          onClose={() => setOpen(false)}
          variants={props.variants}
          storeName={props.storeName}
        />
      )}
    </>
  );
}
export type { PrintableVariantItem };
