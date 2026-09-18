import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The shared furniture of the dashboard: the card shell, its header, the movement
 * indicator, and the two ways a widget admits it has nothing to show.
 *
 * These live together because they are the things every widget on the screen agrees about.
 * If the card radius or the header rhythm were restated in each of a dozen files, the grid
 * would drift apart one card at a time, and the design reference's most noticeable property
 * is that its cards look like siblings.
 *
 * Built on the F1 semantic tokens rather than raw colours, so a retheme stays a change to
 * `globals.css`.
 */

export function DashboardCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-background-card p-4",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function DashboardCardHeader({
  title,
  badge,
  action,
  id,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  /** Wire to the card's `aria-labelledby` so the section has an accessible name. */
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 id={id} className="truncate text-sm font-bold text-primary">
          {title}
        </h3>
        {badge}
      </div>
      {action}
    </div>
  );
}

/** The "View all" affordance the reference puts at the top right of most cards. */
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      style={{ color: "var(--color-primary)" }}
    >
      {children}
    </Link>
  );
}

/**
 * Movement against the comparison period.
 *
 * A null value is the important case, and it renders as words rather than a dash: the
 * previous period had no trade, so there is no percentage to state. An arrow with "0%" would
 * read as "flat", which is a different and false claim.
 */
export function ChangeIndicator({
  value,
  comparisonLabel = "yesterday",
}: {
  value: number | null;
  comparisonLabel?: string;
}) {
  if (value === null) {
    return <span className="text-[11px] text-tertiary">No {comparisonLabel} comparison</span>;
  }

  const positive = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        positive ? "text-success" : "text-danger",
      )}
    >
      <span aria-hidden="true">{positive ? "▲" : "▼"}</span>
      <span className="sr-only">{positive ? "Up" : "Down"}</span>
      {positive ? "+" : ""}
      {value}%
    </span>
  );
}

/** A horizontal share bar, used by the category ranking. */
export function ShareBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-background-active">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }}
      />
    </div>
  );
}

/**
 * The state a widget shows when the query succeeded and returned nothing.
 *
 * Distinct from `WidgetUnavailable` below, and the distinction is the whole point: "no sales
 * yet today" is a fact about the shop, while "AMBURAX cannot compute this" is a fact about
 * the software. Collapsing the two would let a quiet morning look like a broken feature.
 */
export function WidgetEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-background-subtle px-4 py-8 text-center">
      <p className="text-sm font-medium text-primary">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * The state a widget shows when AMBURAX has no way to compute the figure.
 *
 * Deliberately plain and deliberately explicit about *why*. The design reference shows a
 * sales target and an inventory valuation; this product has neither a target model nor a
 * cost price, and the honest response is to say so in the space the number would occupy
 * rather than to leave a persuasive-looking blank.
 */
export function WidgetUnavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border px-4 py-6">
      <p className="text-sm font-medium text-secondary">{title}</p>
      <p className="mt-1 text-xs text-tertiary">{reason}</p>
    </div>
  );
}

/**
 * A product thumbnail, or an honest stand-in for one.
 *
 * The design reference shows a photograph beside every row, and most catalogues will not
 * have one for most products. The stand-in is the product's own initial on a tinted tile —
 * never a generic garment picture, because a cashier picks stock by sight and a photo of
 * something that is not this product is a picking error the screen invited.
 *
 * `img` rather than `next/image`: these are 32px decorations from arbitrary catalogue URLs,
 * and routing them through the optimiser buys nothing while adding a configuration burden
 * for every domain a shop happens to host its pictures on.
 */
export function ProductThumb({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        className="h-8 w-8 shrink-0 rounded-lg border border-border object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background-subtle text-[11px] font-semibold text-tertiary"
      title="No picture for this product yet"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Column headers for the dense tables in the lower half of the reference. */
export function Th({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "pb-2 font-medium text-tertiary",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "py-2",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * A dense table that scrolls sideways rather than overflowing the page.
 *
 * The reference's tables carry five columns in a third of the width, which no phone can
 * show. Letting the table scroll inside its own card keeps the columns legible and keeps the
 * page itself free of horizontal scroll, which is the thing that makes a dashboard feel
 * broken on a phone.
 */
export function DenseTable({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[20rem] text-xs">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
