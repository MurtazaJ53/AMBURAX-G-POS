"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "../../_components/ui";
import { bulkGstAction, type BulkGstState } from "./actions";

const IDLE: BulkGstState = { status: "idle" };

type Row = { id: string; name: string; sku: string; detail: string; price: string };

const TYPES = [
  { value: "TAXABLE", label: "Taxable", hint: "GST is charged" },
  { value: "EXEMPT", label: "Exempt", hint: "Needs the exemption reference" },
  { value: "NIL_RATED", label: "Nil-rated", hint: "0% under GST" },
  { value: "ZERO_RATED", label: "Zero-rated", hint: "Exports / SEZ" },
  { value: "NON_GST", label: "Non-GST", hint: "Outside GST" },
] as const;

/** Tick products, choose one GST type, apply. Choices are the owner's or CA's; nothing is pre-picked. */
export function BulkGstForm({ rows }: { rows: Row[] }) {
  const [state, action, pending] = useActionState(bulkGstAction, IDLE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [type, setType] = useState<string>("");
  const [mode, setMode] = useState<"APPAREL_SLAB" | "FIXED">("APPAREL_SLAB");
  const all = rows.length > 0 && picked.size === rows.length;

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <label className="flex min-h-11 items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={all}
            onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))}
            className="h-4 w-4"
          />
          Select all shown ({rows.length})
        </label>
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50">
                <input type="checkbox" name="variantId" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {r.sku}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-slate-700">{r.price}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-4">
        <p className="text-sm font-semibold text-slate-900">GST type for {picked.size.toLocaleString("en-IN")} selected</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">GST type</legend>
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors ${
                type === t.value ? "border-sky-600 bg-sky-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input type="radio" name="treatment" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} />
              <span>
                <span className="block text-sm font-medium text-slate-900">{t.label}</span>
                <span className="block text-xs text-slate-500">{t.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {type === "TAXABLE" && (
          <div className="amb-fade-in space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="rateMode" value="APPAREL_SLAB" checked={mode === "APPAREL_SLAB"} onChange={() => setMode("APPAREL_SLAB")} />
              Apparel slab (rate by selling price)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="rateMode" value="FIXED" checked={mode === "FIXED"} onChange={() => setMode("FIXED")} />
              Fixed rate
            </label>
            {mode === "FIXED" && (
              <label className="block text-sm font-medium text-slate-700">
                GST rate (%)
                <input name="ratePct" inputMode="decimal" placeholder="e.g. 18" className="amb-focus mt-1 block min-h-11 w-32 rounded-lg border border-slate-300 px-3 tabular-nums" />
              </label>
            )}
          </div>
        )}
        {type === "EXEMPT" && (
          <label className="amb-fade-in block text-sm font-medium text-slate-700">
            Exemption reference
            <input name="exemptionRef" placeholder="Notification or entry no." className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>
        )}

        {state.status !== "idle" && (
          <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-rose-700" : "text-emerald-800"}`}>
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || picked.size === 0 || !type}
          aria-busy={pending}
          className={`${buttonClass("primary")} amb-press w-full justify-center`}
        >
          {pending ? "Saving…" : `Apply to ${picked.size.toLocaleString("en-IN")}`}
        </button>
        <p className="text-xs text-slate-500">Which products are exempt or nil-rated is for you or your CA to decide.</p>
      </aside>
    </form>
  );
}
