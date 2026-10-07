import type { ReactNode } from "react";

/**
 * Presentation pieces shared by the customer flow: the Due & Khata workspace, the detail
 * drawer and the full profile.
 *
 * Server-safe (no hooks, no client boundary), so the drawer and the server pages render the
 * same avatar, segment pill and stat tile and the flow reads as one surface.
 *
 * Nothing here invents a figure. Khata balances live in ERP receivables, which are not
 * connected; the components that sit where those figures will go say so rather than print a
 * zero, because "₹0.00 due" and "we do not know what is due" are different facts.
 */

/* ------------------------------------------------------------------ avatar */

const AVATAR_TONES = [
  "bg-blue-100 text-blue-700 ring-blue-200",
  "bg-emerald-100 text-success ring-emerald-200",
  "bg-amber-100 text-amber-800 ring-amber-200",
  "bg-rose-100 text-danger ring-rose-200",
  "bg-indigo-100 text-indigo-700 ring-indigo-200",
  "bg-teal-100 text-teal-700 ring-teal-200",
] as const;

/** A stable tone per customer id, so a person keeps their colour across pages and reloads. */
export function avatarTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const AVATAR_SIZE = {
  sm: "h-9 w-9 text-[10px]",
  md: "h-12 w-12 text-[11px]",
  xs: "h-7 w-7 text-[10px]",
  lg: "h-16 w-16 text-lg",
} as const;

export function CustomerAvatar(props: { id: string; name: string; size?: keyof typeof AVATAR_SIZE }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset ${AVATAR_SIZE[props.size ?? "sm"]} ${avatarTone(props.id)}`}
    >
      {initialsOf(props.name)}
    </span>
  );
}

/* ----------------------------------------------------------------- badges */

const SEGMENT_TONE: Record<string, string> = {
  RETAIL: "bg-primary-subtle text-blue-700 ring-blue-600/15",
  WHOLESALE: "bg-info-subtle text-violet-700 ring-violet-600/15",
  DISTRIBUTOR: "bg-info-subtle text-teal-700 ring-teal-600/15",
};

export function SegmentPill(props: { segment: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${SEGMENT_TONE[props.segment] ?? "bg-slate-100 text-secondary ring-slate-500/15"}`}
    >
      {props.segment.toLowerCase()}
    </span>
  );
}

/** Active / archived with a dot, so the state never rests on colour alone. */
export function ActiveDot(props: { active: boolean }) {
  return props.active ? (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-success">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-subtle0" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-secondary">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Archived
    </span>
  );
}

/** The marker used wherever a khata figure would be: the data source, not a number. */
export function NotConnectedChip(props: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-secondary ring-1 ring-inset ring-slate-500/15">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
      {props.label ?? "Sync not connected"}
    </span>
  );
}

/* ------------------------------------------------------------- stat tiles */

const STAT_TONE = {
  blue: "bg-primary-subtle text-primary",
  emerald: "bg-success-subtle text-success",
  violet: "bg-info-subtle text-info",
  amber: "bg-warning-subtle text-warning",
  slate: "bg-slate-100 text-tertiary",
} as const;

export function StatTile(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof STAT_TONE;
  /** Position in its row; only staggers the entrance. */
  index?: number;
}) {
  return (
    <div
      className="cust-rise rounded-xl border border-border bg-background-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
      style={{ ["--i" as string]: props.index ?? 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold text-secondary">{props.label}</p>
        {props.icon && (
          <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STAT_TONE[props.tone ?? "blue"]}`}>
            {props.icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-primary tabular-nums">{props.value}</div>
      {props.hint && <div className="mt-1 text-[10px] text-secondary">{props.hint}</div>}
    </div>
  );
}

