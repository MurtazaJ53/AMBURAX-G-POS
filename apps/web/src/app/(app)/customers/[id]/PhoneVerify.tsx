"use client";

import { useActionState } from "react";
import { BadgeCheck, Send } from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { phoneAction, type PhoneState } from "./phoneActions";

const IDLE: PhoneState = { status: "idle" };

/** Q9: verify the customer's phone with a one-time code they read back. Required for udhar. */
export function PhoneVerify({ customerId, verified }: { customerId: string; verified: boolean }) {
  const [state, action, pending] = useActionState(phoneAction, IDLE);
  if (verified || state.status === "verified") {
    return (
      <p className="amb-pop-in flex items-center gap-2 text-sm font-medium text-emerald-700">
        <BadgeCheck aria-hidden="true" className="h-4 w-4" /> Phone verified
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-800"}`}
        >
          {state.message}
        </p>
      )}
      {state.status === "sent" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">
            Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              className="amb-focus mt-1 block min-h-11 w-32 rounded-lg border border-slate-300 px-3 text-center font-mono tracking-widest"
            />
          </label>
          <button type="submit" name="intent" value="confirm" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Checking…" : "Verify"}
          </button>
          <button type="submit" name="intent" value="send" disabled={pending} formNoValidate className={buttonClass("secondary")}>
            Resend
          </button>
        </div>
      ) : (
        <button type="submit" name="intent" value="send" disabled={pending} className={buttonClass("secondary")}>
          <Send aria-hidden="true" className="h-4 w-4" />
          {pending ? "Sending…" : "Send verification code"}
        </button>
      )}
      <p className="text-xs text-slate-500">Needed before giving udhar. Staff can&apos;t mark a phone verified by hand.</p>
    </form>
  );
}
