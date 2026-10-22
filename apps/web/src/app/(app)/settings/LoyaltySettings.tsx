"use client";

import { useActionState } from "react";
import { Gift } from "lucide-react";
import { buttonClass, Card, StatusBadge } from "../_components/ui";
import { saveLoyaltyAction, type LoyaltyState } from "./loyaltyActions";

const IDLE: LoyaltyState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900";

/**
 * Decision 41: the owner writes the loyalty rules down now. Nothing earns or redeems until finance
 * and the GST reviewer approve the tax treatment — that switch isn't on this screen.
 */
export function LoyaltySettings(props: {
  rules: {
    pointsPerUnit: number;
    earnUnitMinor: number;
    pointValueMinor: number;
    expiryMonths: number;
    minRedeemPoints: number;
    maxRedeemBp: number;
  };
  saved: boolean;
}) {
  const [state, action, pending] = useActionState(saveLoyaltyAction, IDLE);
  const r = props.rules;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
          <Gift aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Loyalty points</h2>
            <StatusBadge tone="neutral">Off — waiting for finance and GST sign-off</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Set the rules now; customers earn and redeem only once the tax treatment of points is approved. Points come from
            the bill&apos;s value before GST, and balances only ever change through bills and returns — never by hand.
            {!props.saved && " These are the suggested defaults; save them to keep them."}
          </p>
          <form action={action} className="mt-4 grid gap-4 sm:grid-cols-3">
            {state.status !== "idle" && (
              <p
                role={state.status === "error" ? "alert" : "status"}
                className={`amb-pop-in rounded-lg px-3 py-2 text-sm sm:col-span-3 ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
              >
                {state.message}
              </p>
            )}
            <label className="text-sm font-medium text-slate-700">
              Points earned
              <input name="pointsPerUnit" type="number" min={1} step={1} required defaultValue={r.pointsPerUnit} className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              per ₹ spent (before GST)
              <input name="earnUnitRupees" type="number" min={1} step={1} required defaultValue={r.earnUnitMinor / 100} className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              One point is worth ₹
              <input name="pointValueRupees" type="number" min={0.01} step={0.01} required defaultValue={r.pointValueMinor / 100} className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Points expire after (months)
              <input name="expiryMonths" type="number" min={1} max={60} step={1} required defaultValue={r.expiryMonths} className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Fewest points to redeem
              <input name="minRedeemPoints" type="number" min={0} step={1} required defaultValue={r.minRedeemPoints} className={INPUT} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Points pay at most (% of bill)
              <input name="maxRedeemPercent" type="number" min={0} max={100} step={0.01} required defaultValue={r.maxRedeemBp / 100} className={INPUT} />
            </label>
            <p className="text-xs text-slate-500 sm:col-span-3">
              Oldest-expiring points are used first. A return takes back the points it earned and gives back points it used.
              Points on an udhar bill wait until it is paid.
            </p>
            <div className="sm:col-span-3">
              <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
                {pending ? "Saving…" : "Save rules"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Card>
  );
}
