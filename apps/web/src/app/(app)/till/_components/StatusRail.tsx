"use client";

import Link from "next/link";
import type { SessionState } from "@/client/pos/session";
import type { PosDevice } from "@/client/pos/types";
import { Chip } from "./primitives";
import { useOfflineSync } from "@/client/pos/useOfflineSync";

/**
 * Who is selling, where, on what, and under which shift.
 *
 * Always on screen, never behind a menu. A cashier must be able to answer "am I on the right
 * till, in the right store, under my own shift" without navigating anywhere — that question
 * comes up exactly when something has gone wrong, which is the worst moment to go looking.
 *
 * No cash figure lives here: the opening cash is in the shift panel and the count is in Cash & Day
 * Close, which the rail links to while a shift is open.
 */

function shiftChip(state: SessionState) {
  switch (state.phase) {
    case "active":
      return <Chip tone="positive">Shift open</Chip>;
    case "opening":
      return <Chip tone="info">Opening…</Chip>;
    case "closing":
      return <Chip tone="info">Closing…</Chip>;
    case "closed":
      return <Chip tone="neutral">Shift closed</Chip>;
    case "conflict":
      return <Chip tone="critical">Another cashier</Chip>;
    case "unavailable":
      return <Chip tone="critical">Unavailable</Chip>;
    case "no_session":
      return <Chip tone="caution">No shift</Chip>;
    case "unknown":
      return <Chip tone="neutral">Checking…</Chip>;
  }
}

function openedAtLabel(state: SessionState): string | null {
  const session = state.phase === "active" ? state.session : null;
  if (!session) return null;
  const opened = new Date(session.openedAt);
  if (Number.isNaN(opened.getTime())) return null;
  return opened.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function StatusRail({
  cashierName,
  roleLabel,
  storeName,
  storeCode,
  device,
  session,
}: {
  cashierName: string;
  roleLabel: string;
  storeName: string;
  storeCode: string;
  device: PosDevice | null;
  session: SessionState;
}) {
  const since = openedAtLabel(session);
  const offline = useOfflineSync();

  return (
    <div
      aria-label="Till status"
      role="region"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-amb-lg border border-amb-line bg-amb-raised px-4 py-3 text-amb-ink shadow-amb"
    >
      <Cell label="Cashier" value={cashierName} sub={roleLabel} />
      <Cell label="Store" value={storeName} sub={storeCode} />
      <Cell
        label="Terminal"
        value={device ? device.code : "Not selected"}
        sub={device ? device.name : "Choose a terminal to start"}
      />
      <div className="ml-auto flex items-center gap-3">
        {/* Offline Mode Indicator */}
        {offline.mode === "OFFLINE" ? (
          <Chip tone="caution">Offline Mode ({offline.catalogItemCount} cached items)</Chip>
        ) : offline.mode === "SYNCING" ? (
          <Chip tone="info">Syncing queue…</Chip>
        ) : (
          <Chip tone="positive">Online</Chip>
        )}

        {/* Queued transactions count */}
        {offline.queuedCount > 0 && (
          <span
            className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 border border-amber-300"
            title={`${offline.queuedCount} offline sale(s) waiting for server sync`}
          >
            {offline.queuedCount} queued
          </span>
        )}

        {since && (
          <span className="text-xs text-amb-ink-muted">
            Open since <span className="amb-tnum">{since}</span>
          </span>
        )}
        {device ? shiftChip(session) : <Chip tone="caution">No terminal</Chip>}
        {session.phase === "active" && (
          <Link
            href={`/cash/${session.session.id}`}
            className="amb-press inline-flex min-h-touch items-center rounded-amb bg-amb-accent px-4 text-sm font-semibold text-amb-accent-ink transition-colors hover:bg-amb-accent-hover"
          >
            Count cash &amp; close
          </Link>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-amb-ink-muted">
        {label}
      </p>
      <p className="truncate text-sm font-semibold">{value}</p>
      {sub && <p className="truncate text-xs text-amb-ink-muted">{sub}</p>}
    </div>
  );
}
