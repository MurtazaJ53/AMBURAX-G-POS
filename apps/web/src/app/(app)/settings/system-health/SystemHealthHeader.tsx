"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader, buttonClass } from "../../_components/ui";
import { syncNowAction, type SyncNowState } from "./actions";

const IDLE: SyncNowState = { status: "idle" };

interface SyncStatusResponse {
  status: string;
  running: { sent: number; failed: number } | null;
  pending: number;
  failed: number;
}

export function SystemHealthHeader({
  initialWaiting,
  initialFailed,
  initialRunning,
}: {
  initialWaiting: number;
  initialFailed: number;
  initialRunning: { sent: number; failed: number } | null;
}) {
  const [state, action, pendingAction] = useActionState(syncNowAction, IDLE);
  const router = useRouter();

  const [liveRunning, setLiveRunning] = useState<{ sent: number; failed: number } | null>(initialRunning);
  const [liveWaiting, setLiveWaiting] = useState<number>(initialWaiting);
  const [liveFailed, setLiveFailed] = useState<number>(initialFailed);

  // Poll live count whenever sync is running or when there are records waiting to sync
  useEffect(() => {
    let active = true;

    // Check if we should poll: if sync is running, action is in progress, or records are waiting
    const shouldPoll = liveRunning !== null || pendingAction || liveWaiting > 0;
    if (!shouldPoll) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/operations/sync-status");
        if (!res.ok) return;
        const data: SyncStatusResponse = await res.json();
        if (!active) return;

        setLiveRunning(data.running);
        setLiveWaiting(data.pending);
        setLiveFailed(data.failed);

        // When sync completes (running transitions from active to null), refresh page data
        if (!data.running && liveRunning !== null) {
          router.refresh();
        }
      } catch {
        // network glitch
      }
    }, 2500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [liveRunning, pendingAction, liveWaiting, router]);

  const isBusy = pendingAction || liveRunning !== null;

  // Build live subtitle
  const subtitle =
    liveFailed > 0
      ? `${liveFailed} failed · ${liveWaiting} waiting`
      : liveWaiting > 0
        ? `${liveWaiting.toLocaleString("en-IN")} waiting to sync`
        : "Everything has reached accounting";

  return (
    <PageHeader
      title="System health"
      subtitle={subtitle}
      breadcrumb={[{ label: "Settings", href: "/settings" }]}
      actions={
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
      }
    />
  );
}
