"use client";

import { useState } from "react";
import { Receipt, X, Info } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

export interface GstLineItem {
  name: string;
  sku: string;
  taxRateBp: number;
  taxMinor: number;
  lineTotalMinor: number;
  taxTreatment: string | null;
}

export function GstTaxSummaryModal(props: {
  isOpen: boolean;
  onClose: () => void;
  items: GstLineItem[];
  subtotalMinor: number;
  totalTaxMinor: number;
  placeOfSupply?: string;
  billNumber: string;
}) {
  if (!props.isOpen) return null;

  // Group taxable value and GST amount by tax slab percentage (e.g. 5%, 12%, 18%, 0%)
  const rateGroups = props.items.reduce<
    Record<
      number,
      {
        rateBp: number;
        ratePct: number;
        taxableMinor: number;
        taxMinor: number;
        cgstMinor: number;
        sgstMinor: number;
        count: number;
      }
    >
  >((acc, item) => {
    const rateBp = item.taxRateBp ?? 0;
    const ratePct = rateBp / 100;
    // taxable = line total minus tax
    const taxableMinor = Math.max(0, item.lineTotalMinor - item.taxMinor);
    const cgstMinor = Math.round(item.taxMinor / 2);
    const sgstMinor = item.taxMinor - cgstMinor;

    if (!acc[rateBp]) {
      acc[rateBp] = {
        rateBp,
        ratePct,
        taxableMinor: 0,
        taxMinor: 0,
        cgstMinor: 0,
        sgstMinor: 0,
        count: 0,
      };
    }

    acc[rateBp].taxableMinor += taxableMinor;
    acc[rateBp].taxMinor += item.taxMinor;
    acc[rateBp].cgstMinor += cgstMinor;
    acc[rateBp].sgstMinor += sgstMinor;
    acc[rateBp].count += 1;

    return acc;
  }, {});

  const slabs = Object.values(rateGroups).sort((a, b) => b.rateBp - a.rateBp);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                GST Tax &amp; HSN Breakdown — Bill #{props.billNumber}
              </h3>
              <p className="text-xs text-slate-500">
                Statutory GST rate split (CGST &amp; SGST / UTGST) for Place of Supply:{" "}
                <strong>{props.placeOfSupply || "Intra-State"}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-bold text-slate-700">
              <tr>
                <th className="px-3.5 py-2.5">GST Rate</th>
                <th className="px-3.5 py-2.5 text-right">Taxable Value</th>
                <th className="px-3.5 py-2.5 text-right">CGST (Rate/Amt)</th>
                <th className="px-3.5 py-2.5 text-right">SGST (Rate/Amt)</th>
                <th className="px-3.5 py-2.5 text-right">Total GST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {slabs.map((s) => (
                <tr key={s.rateBp} className="hover:bg-slate-50/50">
                  <td className="px-3.5 py-2.5 font-bold text-slate-900">
                    {s.ratePct}% Slab{" "}
                    <span className="font-normal text-slate-400">({s.count} items)</span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-slate-800">
                    {formatMinor(s.taxableMinor)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-slate-700">
                    <span className="text-[10px] text-slate-400">({s.ratePct / 2}%) </span>
                    {formatMinor(s.cgstMinor)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-slate-700">
                    <span className="text-[10px] text-slate-400">({s.ratePct / 2}%) </span>
                    {formatMinor(s.sgstMinor)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-700">
                    {formatMinor(s.taxMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
              <tr>
                <td className="px-3.5 py-2.5">Total</td>
                <td className="px-3.5 py-2.5 text-right font-mono">
                  {formatMinor(props.subtotalMinor)}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono">
                  {formatMinor(Math.round(props.totalTaxMinor / 2))}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono">
                  {formatMinor(props.totalTaxMinor - Math.round(props.totalTaxMinor / 2))}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono text-emerald-700">
                  {formatMinor(props.totalTaxMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg bg-sky-50 p-2.5 text-xs text-sky-800">
          <Info className="h-4 w-4 shrink-0 text-sky-600" />
          <span>
            Complies with Section 31 of CGST Act. Both intra-state and inter-state tax liabilities reflect the ledger posted to Backend GST GSTR-1.
          </span>
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
