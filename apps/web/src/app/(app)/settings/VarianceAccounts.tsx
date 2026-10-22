"use client";

import { useActionState } from "react";
import { Landmark } from "lucide-react";
import { buttonClass, Card } from "../_components/ui";
import { saveVarianceAccountsAction, type VarianceAccountsState } from "./varianceActions";

const IDLE: VarianceAccountsState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

/** E4: the ERPNext accounts that approved till differences post to. Supplied by finance. */
export function VarianceAccounts(props: { companyName: string; cash: string | null; overShort: string | null; waiting: number }) {
  const [state, action, pending] = useActionState(saveVarianceAccountsAction, IDLE);
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
          <Landmark aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">Till differences in Backend</h2>
          <p className="mt-1 text-sm text-slate-600">
            Approved cash differences for {props.companyName} post as a Journal Entry between these two Backend accounts. Finance
            chooses them; nothing posts until both are set.
            {props.waiting > 0 && <span className="font-semibold text-amber-800"> {props.waiting} approved differences are waiting.</span>}
          </p>
          <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
            {state.status !== "idle" && (
              <p
                role={state.status === "error" ? "alert" : "status"}
                className={`amb-pop-in rounded-lg px-3 py-2 text-sm sm:col-span-2 ${
                  state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
                }`}
              >
                {state.message}
              </p>
            )}
            <label className="text-sm font-medium text-slate-700">
              Cash account
              <input name="cash" defaultValue={props.cash ?? ""} required maxLength={140} placeholder="Cash - AR" className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Cash over/short account
              <input
                name="overShort"
                defaultValue={props.overShort ?? ""}
                required
                maxLength={140}
                placeholder="As named in Backend"
                className={INPUT}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Reason
              <input name="reason" required maxLength={200} placeholder="Accounts confirmed by our CA" className={INPUT} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
                {pending ? "Saving…" : "Save accounts"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Card>
  );
}
