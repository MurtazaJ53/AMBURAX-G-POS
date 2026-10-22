"use client";

import { useActionState } from "react";
import { RotateCw } from "lucide-react";
import { retryAction, type RetryState } from "./actions";

const IDLE: RetryState = { status: "idle" };

export function RetryButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryAction, IDLE);
  if (state.status === "success") {
    return (
      <span role="status" className="amb-pop-in text-sm text-emerald-700">
        {state.message}
      </span>
    );
  }
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="amb-focus amb-press inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50"
      >
        <RotateCw aria-hidden="true" className={`h-4 w-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} />
        Retry
      </button>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
