"use client";

import { useActionState } from "react";
import { buttonClass } from "../../_components/ui";
import { savePosConfigAction, type PosConfigState } from "./actions";

const IDLE: PosConfigState = { status: "idle" };
const INPUT = "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900 disabled:bg-slate-50";

export function PosConfigForm(props: { heldBillHours: number; lateGraceMinutes: number; halfDayPercent: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState(savePosConfigAction, IDLE);
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-3">
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`amb-pop-in rounded-lg px-3 py-2 text-sm sm:col-span-3 ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {state.message}
        </p>
      )}
      <label className="text-sm font-medium text-slate-700">
        Held bills last (hours)
        <input name="heldBillHours" type="number" min={1} max={24} step={1} required disabled={!props.canEdit} defaultValue={props.heldBillHours} className={INPUT} />
        <span className="mt-1 block text-xs font-normal text-slate-500">1 to 24. Stock and price are checked again when a bill is resumed.</span>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Late after (minutes)
        <input name="lateGraceMinutes" type="number" min={0} max={120} step={1} required disabled={!props.canEdit} defaultValue={props.lateGraceMinutes} className={INPUT} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Grace after a shift starts before someone shows as late.</span>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Half day below (% of shift)
        <input name="halfDayPercent" type="number" min={10} max={90} step={1} required disabled={!props.canEdit} defaultValue={props.halfDayPercent} className={INPUT} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Of the shift&apos;s paid time, after the break.</span>
      </label>
      {props.canEdit && (
        <div className="sm:col-span-3">
          <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}
