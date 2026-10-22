"use client";

import { useActionState } from "react";
import { PlugZap } from "lucide-react";
import { buttonClass, StatusBadge } from "../../_components/ui";
import { connectErpAction, type ConnectState } from "./actions";
import { backendWording } from "@/lib/backendWording";

const IDLE: ConnectState = { status: "idle" };

/** Not connected yet: the owner starts the connection (site, company, warehouses) here. */
export function ConnectErp(props: { status: string; error: string | null }) {
  const [state, action, pending] = useActionState(connectErpAction, IDLE);
  const working = props.status === "PROVISIONING";
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-slate-700">
        {working ? (
          <StatusBadge tone="info">Connecting…</StatusBadge>
        ) : props.status === "FAILED" ? (
          <StatusBadge tone="danger">Couldn&apos;t connect</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not connected</StatusBadge>
        )}
        {working
          ? "Setting up your company and a warehouse for each store. You can keep selling meanwhile."
          : "Connecting creates your company in Backend (Indian rupees, India) and a warehouse for every store."}
      </p>
      {props.status === "FAILED" && props.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
          {backendWording(props.error)}
        </p>
      )}
      {state.status !== "idle" && (
        <p role={state.status === "error" ? "alert" : "status"} className={`amb-pop-in ${state.status === "error" ? "text-rose-700" : "text-emerald-800"}`}>
          {state.message}
        </p>
      )}
      {!working && (
        <form action={action}>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
            <PlugZap aria-hidden="true" className="h-4 w-4" />
            {props.status === "FAILED" ? "Try again" : "Connect to Backend"}
          </button>
        </form>
      )}
    </div>
  );
}
