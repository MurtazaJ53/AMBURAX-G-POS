"use client";

import { useActionState } from "react";
import { RotateCw } from "lucide-react";
import { retryAllAction, type RetryState } from "./actions";

const IDLE: RetryState = { status: "idle" };

export function RetryAllButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState(retryAllAction, IDLE);

  if (state.status === "success") {
    return (
      <span role="status" className="amb-pop-in text-sm font-medium text-emerald-700">
        {state.message}
      </span>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="amb-focus amb-press inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-1.5 text-xs font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
      >
        <RotateCw
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {pending ? "Retrying all..." : `Retry all (${count})`}
      </button>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
