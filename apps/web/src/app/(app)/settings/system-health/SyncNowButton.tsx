"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { syncNowAction, type SyncNowState } from "./actions";

const IDLE: SyncNowState = { status: "idle" };

interface SyncStatusResponse {
  status: string;
  running: { sent: number; failed: number } | null;
  pending: number;
  failed: number;
}

/** Manual "Sync now" with live auto-polling counter so the user sees progress without manual refresh. */
export function SyncNowButton({
  waiting: initialWaiting,
  running: initialRunning,
}: {
  waiting: number;
  running: { sent: number; failed: number } | null;
}) {
  const [state, action, pendingAction] = useActionState(syncNowAction, IDLE);
  const router = useRouter();

  const [liveRunning, setLiveRunning] = useState<{ sent: number; failed: number } | null>(initialRunning);
  const [liveWaiting, setLiveWaiting] = useState<number>(initialWaiting);

  // Poll live count when sync is active or after button is clicked
  useEffect(() => {
    let active = true;
    const isSyncActive = liveRunning !== null || pendingAction || state.status === "success";

    if (!isSyncActive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/operations/sync-status");
        if (!res.ok) return;
        const data: SyncStatusResponse = await res.json();
        if (!active) return;

        setLiveRunning(data.running);
        setLiveWaiting(data.pending);

        // When sync completes (running becomes null), refresh the page content to update the tables
        if (!data.running && liveRunning !== null) {
          router.refresh();
        }
      } catch {
        // network glitch
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [liveRunning, pendingAction, state.status, router]);

  const isBusy = pendingAction || liveRunning !== null;

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <button
        type="submit"
        disabled={isBusy || liveWaiting === 0}
        aria-busy={isBusy}
        className={`${buttonClass("primary")} amb-press`}
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-4 w-4 ${isBusy ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {liveRunning
          ? `Syncing… ${liveRunning.sent.toLocaleString("en-IN")} sent`
          : pendingAction
            ? "Starting…"
            : liveWaiting > 0
              ? `Sync now (${liveWaiting.toLocaleString("en-IN")})`
              : "All synced"}
      </button>
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`amb-pop-in max-w-sm text-right text-xs ${
            state.status === "error" ? "text-rose-700" : "text-emerald-800"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
