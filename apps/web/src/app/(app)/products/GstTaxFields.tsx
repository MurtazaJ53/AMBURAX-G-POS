"use client";

import { useState } from "react";

const TAX_TREATMENTS = ["TAXABLE", "EXEMPT", "NIL_RATED", "ZERO_RATED", "NON_GST", "UNSPECIFIED"] as const;

const RATE_OPTIONS = [0, 500, 1200, 1800, 2800] as const;

/** The rate select's value for the garment slab (5% / 18% by price, from Store settings). */
export const SLAB_RATE_VALUE = "SLAB";

/**
 * Read the rate select. The slab sends a provisional 5% with APPAREL_SLAB; the server replaces
 * it with the slab rate at the list price, and the till re-picks it after any discount.
 */
export function readTaxRate(formData: FormData): { taxRateBp: number; taxRateMode: "FIXED" | "APPAREL_SLAB" } {
  const treatment = formData.get("taxTreatment") as string;
  const raw = formData.get("taxRateBp");

  // Non-taxable treatments (NON_GST, EXEMPT, NIL_RATED, ZERO_RATED) must have 0 rate
  if (treatment && treatment !== "TAXABLE") {
    return { taxRateBp: 0, taxRateMode: "FIXED" };
  }

  if (raw === SLAB_RATE_VALUE) return { taxRateBp: 500, taxRateMode: "APPAREL_SLAB" };
  return { taxRateBp: Number(raw) || 0, taxRateMode: "FIXED" };
}

export function GstTaxFields(props: {
  taxTreatment?: string;
  taxRateBp?: number;
  taxExemptionRef?: string | null;
  taxRateMode?: string;
}) {
  const [treatment, setTreatment] = useState<string>(props.taxTreatment ?? "TAXABLE");

  return (
    <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">Tax classification</legend>
      <p className="text-xs text-slate-600">
        Select the classification confirmed for this item. For garments sold in India under GST, select &quot;TAXABLE&quot; and &quot;Garment slab&quot;.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="taxTreatment" className="block text-sm font-medium text-slate-700">Treatment</label>
          <select
            id="taxTreatment"
            name="taxTreatment"
            value={treatment}
            onChange={(e) => setTreatment(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {TAX_TREATMENTS.map((t) => (
              <option key={t} value={t}>{t === "TAXABLE" ? "TAXABLE (Standard GST)" : t.replaceAll("_", " ")}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="taxRateBp" className="block text-sm font-medium text-slate-700">Rate</label>
          {treatment === "TAXABLE" ? (
            <select
              id="taxRateBp"
              name="taxRateBp"
              defaultValue={props.taxRateMode === "APPAREL_SLAB" ? SLAB_RATE_VALUE : (props.taxRateBp ?? SLAB_RATE_VALUE)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value={SLAB_RATE_VALUE}>Garment slab (5% ≤₹2500, 18% &gt;₹2500)</option>
              {RATE_OPTIONS.filter((r) => r > 0).map((rate) => (
                <option key={rate} value={rate}>{rate / 100}%</option>
              ))}
            </select>
          ) : (
            <div className="mt-1 flex min-h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
              0% (Non-taxable / Exempt)
              <input type="hidden" name="taxRateBp" value="0" />
            </div>
          )}
        </div>
        {treatment === "EXEMPT" && (
          <div className="sm:col-span-2">
            <label htmlFor="taxExemptionRef" className="block text-sm font-medium text-slate-700">Statutory exemption reference *</label>
            <input
              id="taxExemptionRef"
              name="taxExemptionRef"
              maxLength={200}
              required
              defaultValue={props.taxExemptionRef ?? ""}
              aria-describedby="taxExemptionRef-help"
              placeholder="e.g. Notification No. 12/2017-Central Tax"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p id="taxExemptionRef-help" className="mt-1 text-xs text-slate-500">Required by GST law for exempt items.</p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
