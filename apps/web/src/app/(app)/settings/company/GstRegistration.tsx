"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { BadgePercent } from "lucide-react";
import { buttonClass, Card, CardHeader } from "../../_components/ui";
import { turnOnGstAction, type GstState } from "./actions";

const IDLE: GstState = { status: "idle" };

/**
 * Turn GST on for a business that registers after signing up. From today its bills carry GST on
 * taxable products; older bills are untouched. Products that were "no GST" must be given a GST
 * type before they sell again (owner option A).
 */
export function GstRegistration() {
  const [state, action, pending] = useActionState(turnOnGstAction, IDLE);
  const [gstin, setGstin] = useState("");
  if (state.status === "success") {
    return (
      <Card className="amb-pop-in">
        <CardHeader title="GST is on" subtitle={state.message} />
        {(state.needsReview ?? 0) > 0 && (
          <div className="px-5 pb-5">
            <Link href="/products/gst" className={`${buttonClass("primary")} amb-press`}>
              Set GST types now
            </Link>
          </div>
        )}
      </Card>
    );
  }
  return (
    <Card className="amb-fade-in">
      <CardHeader
        title="Turn on GST"
        subtitle="Registered for GST? Add your GSTIN. Bills from today carry GST on taxable products; exempt, nil-rated and non-GST products sell without it."
      />
      <form action={action} className="space-y-4 px-5 pb-5">
        <label className="block text-sm font-medium text-slate-700">
          GSTIN
          <input
            name="gstin"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ""))}
            maxLength={15}
            autoComplete="off"
            placeholder="24ABCDE1234F1Z5"
            className="amb-focus mt-1 block min-h-11 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm uppercase tracking-wider text-slate-900"
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
          <span>
            I am GST-registered from today. Products marked &quot;no GST&quot; now will need a GST type before they can be sold
            again.
          </span>
        </label>
        {state.status === "error" && (
          <p role="alert" className="text-sm text-rose-700">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={pending || gstin.length !== 15} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          <BadgePercent aria-hidden="true" className="h-4 w-4" />
          {pending ? "Turning on…" : "Turn on GST"}
        </button>
      </form>
    </Card>
  );
}
