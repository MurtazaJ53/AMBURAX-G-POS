"use client";

import { useActionState } from "react";
import { buttonClass } from "../../_components/ui";
import { reviewAction, type ReviewState } from "./actions";

const IDLE: ReviewState = { status: "idle" };

/** Renew or release one reservation, with a reason (decision 36: never released silently). */
export function ReviewForm({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(reviewAction, IDLE);
  if (state.status === "success") {
    return (
      <p role="status" className="amb-pop-in text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`reason-${id}`}>
        Reason for {label}
      </label>
      <input
        id={`reason-${id}`}
        name="reason"
        required
        minLength={3}
        maxLength={200}
        placeholder="Reason"
        className="amb-focus min-h-11 w-40 rounded-lg border border-slate-300 px-3 text-sm"
      />
      <button type="submit" name="decision" value="RENEW" disabled={pending} className={buttonClass("secondary")}>
        Keep 7 days
      </button>
      <button
        type="submit"
        name="decision"
        value="RELEASE"
        disabled={pending}
        className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
      >
        Release
      </button>
      {state.status === "error" && (
        <span role="alert" className="w-full text-right text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
