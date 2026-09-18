import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The AMBURAX design system primitives.
 *
 * Every workspace screen is built from these so the product reads as one application
 * rather than a set of separately-styled pages. Changing a radius, a border colour or an
 * empty-state voice happens here once.
 *
 * Visual baseline, from UI_DESIGN_SYSTEM.md: premium light SaaS — white surfaces on a
 * very light ground, navy text, **blue primary action**, semantic accents, rounded cards,
 * subtle borders and shadows, dense but readable tables.
 *
 * These are server components by default. Nothing here holds state, so a screen only needs
 * a client boundary where it genuinely has interaction.
 */

/* ------------------------------------------------------------------ surfaces */

export function Card(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

export function CardHeader(props: { title: string; action?: ReactNode; subtitle?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
        {props.subtitle && <p className="mt-0.5 text-xs text-slate-500">{props.subtitle}</p>}
      </div>
      {props.action}
    </div>
  );
}

/* -------------------------------------------------------------- page header */

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: { label: string; href: string }[];
}) {
  return (
    <div className="mb-6">
      {props.breadcrumb && props.breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-slate-500">
          {props.breadcrumb.map((crumb, i) => (
            <span key={crumb.href} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">/</span>}
              <Link href={crumb.href} className="hover:text-slate-900 hover:underline">
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{props.title}</h1>
          {props.subtitle && <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p>}
        </div>
        {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- KPIs */

export type KpiTone = "blue" | "violet" | "emerald" | "amber" | "rose";

const KPI_TONE: Record<KpiTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
};

/**
 * A headline figure.
 *
 * `value` is required and `hint` is optional, but there is deliberately no "change vs
 * yesterday" slot. A trend needs a comparison the screen can actually compute; an arrow
 * with no real basis is the most convincing kind of fake number, so the component cannot
 * render one.
 */
export function KpiCard(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{props.label}</p>
        {props.icon && (
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KPI_TONE[props.tone ?? "blue"]}`}
          >
            {props.icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{props.value}</p>
      {props.hint && <p className="mt-1 text-xs text-slate-500">{props.hint}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ badges */

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

const BADGE_TONE: Record<BadgeTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/20",
};

export function StatusBadge(props: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONE[props.tone]}`}
    >
      {props.children}
    </span>
  );
}

/**
 * Stock presentation, in one place because getting it wrong is a correctness problem.
 *
 * ADR-080: `StockLevel` is an AMBURAX **operational count**, not an ERPNext-authoritative
 * ledger figure. Null means "never counted in this store", which is a different fact from
 * zero, and negative means the projection has drifted below zero through overselling —
 * both are shown as what they are rather than smoothed into a tidy number.
 *
 * There is no reorder-level column in the schema, so this deliberately never says "low
 * stock": that would be a threshold claim the data cannot support.
 */
export function StockBadge(props: { quantity: number | null }) {
  if (props.quantity === null) {
    return <StatusBadge tone="neutral">Not counted</StatusBadge>;
  }
  if (props.quantity < 0) {
    return <StatusBadge tone="danger">Oversold ({props.quantity})</StatusBadge>;
  }
  if (props.quantity === 0) {
    return <StatusBadge tone="warning">Out of stock</StatusBadge>;
  }
  return <StatusBadge tone="success">{props.quantity} on hand</StatusBadge>;
}

/* ----------------------------------------------------------------- buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "success";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-600",
  ghost: "text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-600",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none";

export function buttonClass(variant: ButtonVariant = "primary"): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`;
}

export function LinkButton(props: {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={props.href} className={`${buttonClass(props.variant)} ${props.className ?? ""}`}>
      {props.children}
    </Link>
  );
}

/* ------------------------------------------------------------------ tables */

export function DataTable(props: { children: ReactNode; caption?: string }) {
  // The horizontal scroll container is on the table alone, never on the page: a dense
  // enterprise table may exceed a tablet's width, but the workspace around it must not.
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        {props.caption && <caption className="sr-only">{props.caption}</caption>}
        {props.children}
      </table>
    </div>
  );
}

const ALIGN: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Th(props: { children: ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 ${ALIGN[props.align ?? "left"]}`}
    >
      {props.children}
    </th>
  );
}

export function Td(props: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-slate-700 ${ALIGN[props.align ?? "left"]} ${props.className ?? ""}`}>
      {props.children}
    </td>
  );
}

/* ------------------------------------------------------------------ states */

/**
 * The states every workspace surface owes the operator, per UI_DESIGN_SYSTEM.md: loading,
 * empty, error, permission denied. They are components rather than ad-hoc markup so no
 * screen can quietly skip one.
 */
export function LoadingState(props: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
      />
      <p className="text-sm text-slate-500" role="status">
        {props.label ?? "Loading…"}
      </p>
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {props.icon && (
        <span
          aria-hidden="true"
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"
        >
          {props.icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-900">{props.title}</p>
      {props.description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{props.description}</p>
      )}
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

export function ErrorState(props: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium text-slate-900">{props.title ?? "Something went wrong"}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {props.description ?? "This didn't load. Nothing was changed — try again."}
      </p>
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

export function PermissionDeniedState(props: { title: string; description: string; hint?: string }) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <div role="alert">
        <p className="text-base font-semibold text-slate-900">{props.title}</p>
        <p className="mt-2 text-sm text-slate-600">{props.description}</p>
        {props.hint && <p className="mt-4 text-xs text-slate-400">{props.hint}</p>}
      </div>
    </Card>
  );
}

/**
 * A module that exists in the product roadmap but is not built yet.
 *
 * Its own screen, reached from its own navigation entry, saying plainly that it is not
 * here. This is the alternative to two worse options: hiding the roadmap entirely, or
 * shipping a screen that looks functional and is not.
 */
export function ComingLaterState(props: { module: string; phase?: string; description: string }) {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <StatusBadge tone="neutral">Not built yet</StatusBadge>
      <p className="mt-4 text-base font-semibold text-slate-900">{props.module}</p>
      <p className="mt-2 text-sm text-slate-600">{props.description}</p>
      {props.phase && <p className="mt-4 text-xs text-slate-400">Planned for {props.phase}</p>}
      <p className="mt-6 text-xs text-slate-400">
        Nothing on this screen is functional yet, and AMBURAX won&apos;t pretend otherwise.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ quick actions */

export function QuickAction(props: {
  href: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={props.href}
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-4 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/50"
    >
      {props.icon && (
        <span aria-hidden="true" className="text-slate-400">
          {props.icon}
        </span>
      )}
      <span className="text-sm font-medium text-slate-900">{props.label}</span>
      {props.hint && <span className="text-xs text-slate-500">{props.hint}</span>}
    </Link>
  );
}

/* -------------------------------------------------------------- pagination */

/**
 * Real pagination over a real total.
 *
 * Renders as links rather than buttons so a page is addressable, shareable and survives a
 * refresh, and so the control works without JavaScript. The range is always honest: it
 * states which rows of how many are on screen, so nobody has to guess whether older records
 * still exist.
 */
export function Pagination(props: {
  basePath: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Carried through so paging never silently drops the active search or filters. */
  params?: Record<string, string | undefined>;
}) {
  const { page, pageCount, total, pageSize } = props;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  function href(target: number): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(props.params ?? {})) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `${props.basePath}?${qs}` : props.basePath;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
      <p className="text-xs text-slate-500">
        {total === 0 ? "No records" : `Showing ${first}–${last} of ${total}`}
      </p>

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          {page > 1 ? (
            <Link
              href={href(page - 1)}
              rel="prev"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-300">
              Previous
            </span>
          )}

          <span className="px-2 text-xs text-slate-500">
            Page {page} of {pageCount}
          </span>

          {page < pageCount ? (
            <Link
              href={href(page + 1)}
              rel="next"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-300">
              Next
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ search input */

/**
 * Server-rendered search: a plain GET form, so results are linkable, survive a refresh and
 * work without JavaScript. A till that has just been reloaded is exactly when someone needs
 * to look something up.
 */
export function SearchForm(props: {
  action: string;
  placeholder: string;
  defaultValue?: string;
  label: string;
  hiddenFields?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <form method="get" action={props.action} className="flex flex-wrap items-center gap-2">
      {Object.entries(props.hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        name="q"
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        aria-label={props.label}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      {props.children}
      <button type="submit" className={buttonClass("primary")}>
        Search
      </button>
    </form>
  );
}
