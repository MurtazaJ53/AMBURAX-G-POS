"use client";

import { useActionState } from "react";
import { buttonClass, Card, CardHeader } from "../_components/ui";
import { saveApparelSlabAction, type SlabActionState } from "./taxActions";

const IDLE: SlabActionState = { status: "idle" };

const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900";

function rupees(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

function percent(bp: number): string {
  return bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2);
}

/** The garment GST slab: one price limit per piece and the two rates either side of it. */
export function GstSlabSettings({ slab }: { slab: { thresholdMinor: number; lowRateBp: number; highRateBp: number } }) {
  const [state, formAction, pending] = useActionState(saveApparelSlabAction, IDLE);
  return (
    <Card>
      <CardHeader
        title="Garment GST slab"
        subtitle="Used by products set to “Garment slab”. The rate is chosen per piece from the price after discount."
      />
      <form action={formAction} className="space-y-4 px-5 pb-5" noValidate>
        {state.status !== "idle" && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${
              state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {state.message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Price limit per piece (₹, excluding GST)
            <input name="threshold" inputMode="decimal" defaultValue={rupees(slab.thresholdMinor)} className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Rate at or below the limit (%)
            <input name="lowRate" inputMode="decimal" defaultValue={percent(slab.lowRateBp)} className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Rate above the limit (%)
            <input name="highRate" inputMode="decimal" defaultValue={percent(slab.highRateBp)} className={INPUT} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Set from the owner’s decision of 13 Oct 2026 (5% up to ₹2,500, 18% above). Confirm with your CA before
          changing it.
        </p>
        <div className="flex justify-end">
          <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary")}>
            {pending ? "Saving…" : "Save GST slab"}
          </button>
        </div>
      </form>
    </Card>
  );
}
