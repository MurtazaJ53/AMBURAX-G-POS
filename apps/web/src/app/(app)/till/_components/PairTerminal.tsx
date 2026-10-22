"use client";

import { useState } from "react";

/**
 * One click to make this computer a terminal: the signed-in owner or store manager presses "Use this
 * computer as …" and the terminal becomes ACTIVE (no pairing code to copy). A cashier without that
 * role is told who can do it. Server: POST /api/v1/pos/devices/[id]/pair-here.
 */
export function PairTerminal({ devices }: { devices: { id: string; code: string; name: string }[] }) {
  const [state, setState] = useState<{ status: "idle" | "busy" | "error" | "done"; id?: string; message?: string }>({ status: "idle" });

  async function pair(id: string) {
    setState({ status: "busy", id });
    try {
      const res = await fetch(`/api/v1/pos/devices/${id}/pair-here`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", id, message: data?.error?.message ?? "That didn't work. Try again." });
        return;
      }
      setState({ status: "done", id, message: `${data?.device?.name ?? "The terminal"} is ready. Loading…` });
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setState({ status: "error", id, message: "Couldn't reach the server. Check the connection and try again." });
    }
  }

  return (
    <div className="space-y-2 rounded-amb border border-amb-line bg-amb-raised px-3 py-3">
      <p className="text-sm font-semibold text-amb-ink">Set up this computer as a till</p>
      <p className="text-xs text-amb-ink-muted">One time only. An owner or store manager presses the button on the counter computer.</p>
      <div className="flex flex-wrap gap-2">
        {devices.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => void pair(d.id)}
            disabled={state.status === "busy" || state.status === "done"}
            aria-busy={state.status === "busy" && state.id === d.id}
            className="amb-press min-h-touch rounded-amb bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {state.status === "busy" && state.id === d.id ? "Setting up…" : `Use this computer as ${d.name}`}
          </button>
        ))}
      </div>
      {state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-rose-700" : "text-emerald-800"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
