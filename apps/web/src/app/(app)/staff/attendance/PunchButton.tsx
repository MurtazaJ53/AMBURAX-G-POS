"use client";

import { useActionState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { punchAction, type PunchState } from "./actions";

const IDLE: PunchState = { status: "idle" };

/** Clock yourself in or out of the current store. */
export function PunchButton({ clockedIn }: { clockedIn: boolean }) {
  const [state, action, pending] = useActionState(punchAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="logType" value={clockedIn ? "OUT" : "IN"} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={`${buttonClass(clockedIn ? "secondary" : "primary")} amb-press`}
      >
        {clockedIn ? <LogOut aria-hidden="true" className="h-4 w-4" /> : <LogIn aria-hidden="true" className="h-4 w-4" />}
        {pending ? "Saving…" : clockedIn ? "Clock out" : "Clock in"}
      </button>
      {state.status !== "idle" && (
        <span
          role={state.status === "error" ? "alert" : "status"}
          className={`amb-pop-in text-sm ${state.status === "error" ? "text-rose-700" : "text-emerald-700"}`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
