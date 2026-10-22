"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { GstTaxSummaryModal, type GstLineItem } from "./GstTaxSummaryModal";

export function GstSummaryButton(props: {
  items: GstLineItem[];
  subtotalMinor: number;
  totalTaxMinor: number;
  placeOfSupply?: string;
  billNumber: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
      >
        <Receipt className="h-3.5 w-3.5 text-emerald-600" />
        <span>GST Breakdown</span>
      </button>

      <GstTaxSummaryModal
        isOpen={open}
        onClose={() => setOpen(false)}
        items={props.items}
        subtotalMinor={props.subtotalMinor}
        totalTaxMinor={props.totalTaxMinor}
        placeOfSupply={props.placeOfSupply}
        billNumber={props.billNumber}
      />
    </>
  );
}
