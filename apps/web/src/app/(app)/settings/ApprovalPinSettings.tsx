"use client";

import { useActionState, useEffect, useRef } from "react";
import { buttonClass, Card, CardHeader } from "../_components/ui";
import { saveApprovalPinAction, type PinActionState } from "./pinActions";

const IDLE: PinActionState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900";

/** Your own PIN: switches the shared Till to you, and for an owner or store manager also approves discounts above 10%. */
export function ApprovalPinSettings({ hasPin, canApprove }: { hasPin: boolean; canApprove: boolean }) {
  const [state, formAction, pending] = useActionState(saveApprovalPinAction, IDLE);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") form.current?.reset();
  }, [state]);
  const invalid = (f: string) => (state.status === "error" && state.field === f) || undefined;

  return (
    <Card>
      <CardHeader
        title="Your PIN"
        subtitle={`${hasPin ? "Set." : "Not set."} On the shared Till, tap your name and type this PIN to sell under your name.${
          canApprove ? " You also use it to approve discounts above 10%." : ""
        }`}
      />
      <form ref={form} action={formAction} className="space-y-4 px-5 pb-5" noValidate>
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
            Your password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              aria-invalid={invalid("currentPassword")}
              className={INPUT}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {hasPin ? "New PIN" : "PIN"} <span className="font-normal text-slate-500">(4–6 digits)</span>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              aria-invalid={invalid("pin")}
              className={INPUT}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Repeat PIN
            <input
              name="confirmPin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              aria-invalid={invalid("confirmPin")}
              className={INPUT}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Five wrong tries lock the PIN for 15 minutes. Don&apos;t share it; every approval is recorded against your name.
        </p>
        <div className="flex justify-end">
          <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary")}>
            {pending ? "Saving…" : hasPin ? "Change PIN" : "Set PIN"}
          </button>
        </div>
      </form>
    </Card>
  );
}
