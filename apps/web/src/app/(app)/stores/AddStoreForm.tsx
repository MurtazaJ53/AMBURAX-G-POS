"use client";

import { useActionState, useState } from "react";
import { Store } from "lucide-react";
import { buttonClass } from "../_components/ui";
import { addStoreAction, type AddStoreState } from "./actions";

const IDLE: AddStoreState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 aria-[invalid=true]:border-rose-500";

/** Screen 70: add another store. It joins the business's company and gets its own ERPNext warehouse. */
export function AddStoreForm({ states }: { states: string[] }) {
  const [state, action, pending] = useActionState(addStoreAction, IDLE);
  const [open, setOpen] = useState(false);
  const bad = (f: string) => (state.status === "error" && state.field === f ? true : undefined);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("primary")} amb-press`}>
        <Store aria-hidden="true" className="h-4 w-4" />
        Add store
      </button>
    );
  }
  return (
    <form action={action} key={state.nonce} className="amb-pop-in grid w-full gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm sm:col-span-3 ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {state.message}
        </p>
      )}
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">
        Store name
        <input name="name" required minLength={2} maxLength={80} placeholder="Surat Ring Road" aria-invalid={bad("name")} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Code
        <input name="code" required pattern="[A-Za-z0-9]{2,10}" placeholder="SURAT2" aria-invalid={bad("code")} className={`${INPUT} uppercase`} />
      </label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-3">
        Street address
        <input name="addressLine" required minLength={3} aria-invalid={bad("addressLine")} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        City
        <input name="city" required minLength={2} aria-invalid={bad("city")} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        State
        <select name="state" required defaultValue="" aria-invalid={bad("state")} className={INPUT}>
          <option value="" disabled>
            Choose…
          </option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        PIN code <span className="font-normal text-slate-500">(optional)</span>
        <input name="postalCode" inputMode="numeric" pattern="\d{6}" aria-invalid={bad("postalCode")} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Phone <span className="font-normal text-slate-500">(optional)</span>
        <input name="phone" type="tel" className={INPUT} />
      </label>
      <div className="flex gap-2 sm:col-span-3">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          {pending ? "Adding…" : "Add store"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
          Close
        </button>
      </div>
    </form>
  );
}
