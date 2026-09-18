import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CircleDot, Plus } from "lucide-react";
import { initialsOf, seriesColour } from "@/server/dashboard/dashboardTransforms";
import type {
  DashboardShiftActivity,
  DashboardStockSignal,
} from "@/server/dashboard/dashboardQueries";
import { CardLink, DashboardCard, DashboardCardHeader, WidgetUnavailable } from "./primitives";

/**
 * The bottom row of the reference: a call to action, who is on shift, targets, and system
 * health.
 *
 * Two of the four are where this dashboard most visibly departs from the design. The
 * reference shows a sales target with a progress ring, and a staff panel reading "8 Active /
 * 1 Break". AMBURAX has no target model and no break state, so the target card states that
 * plainly and the staff card reports only what a POS session can prove: a shift is open, and
 * these are the people on it.
 */

/**
 * Who is on the tills right now.
 *
 * Avatars are initials of real users with an open session, not a decorative stack. Where
 * nobody is on shift the card says so — an empty avatar row would read as "loading".
 */
export function ShiftStatusCard({ activity }: { activity: DashboardShiftActivity }) {
  const overflow = activity.cashiers.length - 5;

  return (
    <DashboardCard aria-labelledby="shift-status-heading">
      <DashboardCardHeader
        id="shift-status-heading"
        title="On shift"
        action={<CardLink href="/settings/terminals">Terminals</CardLink>}
      />

      <div className="mb-3 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            activity.openSessions > 0 ? "bg-success" : "bg-background-active"
          }`}
        />
        <span className="text-xs font-medium text-secondary">
          {activity.openSessions === 0
            ? "No till open"
            : `${activity.openSessions} till${activity.openSessions === 1 ? "" : "s"} open`}
        </span>
        <span className="ml-auto text-[10px] text-tertiary">
          {activity.staffCount} in this store
        </span>
      </div>

      {activity.cashiers.length === 0 ? (
        <p className="text-xs text-tertiary">
          Shifts show here once someone opens a till on a paired terminal.
        </p>
      ) : (
        <div className="flex items-center">
          {activity.cashiers.slice(0, 5).map((cashier, index) => (
            <span
              key={cashier.userId}
              title={cashier.name}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background-card text-[10px] font-bold text-white"
              style={{ background: seriesColour(index), marginLeft: index > 0 ? -8 : 0 }}
            >
              {initialsOf(cashier.name)}
            </span>
          ))}
          {overflow > 0 && (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background-card bg-background-active text-[10px] font-bold text-secondary"
              style={{ marginLeft: -8 }}
            >
              +{overflow}
            </span>
          )}
          <span className="sr-only">
            On shift: {activity.cashiers.map((cashier) => cashier.name).join(", ")}
          </span>
        </div>
      )}
    </DashboardCard>
  );
}

/**
 * Targets.
 *
 * There is no target anywhere in the schema — not on Store, not on Tenant, not per user. So
 * this card holds a designed "not configured" state rather than a progress ring against an
 * invented number. A ring at 68% of a target nobody set is the single most misleading thing
 * this screen could show.
 */
export function TargetsCard() {
  return (
    <DashboardCard aria-labelledby="targets-heading">
      <DashboardCardHeader id="targets-heading" title="Today's target" />
      <WidgetUnavailable
        title="No target configured"
        reason="AMBURAX cannot set or store sales targets yet, so there is nothing to measure today against."
      />
    </DashboardCard>
  );
}

/**
 * System status, from facts rather than from optimism.
 *
 * The reference shows "All Systems Operational". That claim needs monitoring this product
 * does not have, so each line here is something the page can actually observe: whether a till
 * is open, whether the catalogue has been counted into this store, and whether accounting is
 * connected — which it is not, because no ERPNext adapter exists.
 */
export function SystemStatusCard({
  activity,
  stock,
}: {
  activity: DashboardShiftActivity;
  stock: DashboardStockSignal;
}) {
  const rows = [
    {
      key: "till",
      label: "Till sessions",
      detail: activity.openSessions > 0 ? `${activity.openSessions} open` : "None open",
      tone: activity.openSessions > 0 ? "ok" : "idle",
    },
    {
      key: "stock",
      label: "Stock counted",
      detail:
        stock.uncountedVariants === 0
          ? "Whole catalogue counted here"
          : `${stock.uncountedVariants} never counted`,
      tone: stock.uncountedVariants === 0 ? "ok" : "warn",
    },
    {
      key: "erp",
      label: "Accounting",
      detail: "Not connected",
      tone: "warn",
    },
  ] as const;

  return (
    <DashboardCard aria-labelledby="system-status-heading">
      <DashboardCardHeader id="system-status-heading" title="System status" />
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            {row.tone === "ok" ? (
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <CircleDot
                aria-hidden="true"
                className={`h-3.5 w-3.5 shrink-0 ${
                  row.tone === "warn" ? "text-warning" : "text-tertiary"
                }`}
              />
            )}
            <span className="text-xs text-secondary">{row.label}</span>
            <span className="ml-auto truncate text-[10px] text-tertiary">{row.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] text-tertiary">
        Sales are recorded in AMBURAX and are not posted to accounting.
      </p>
    </DashboardCard>
  );
}

/**
 * The dark call-to-action tile the reference uses for seasonal merchandising.
 *
 * Kept as a shape, dropped as a claim: "New Season Collection" is a garment-retail campaign,
 * and AMBURAX is not a garment product. It points instead at the next real step for a
 * business whose catalogue is thin, and is rendered only when that is actually true and the
 * operator is allowed to act on it.
 */
export function NextStepBanner({ uncountedVariants }: { uncountedVariants: number }) {
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-slate-800 p-4">
      <div className="z-10 flex-1">
        <p className="text-sm font-bold text-white">Finish setting up your catalogue</p>
        <p className="mb-3 mt-0.5 text-[10px] text-slate-400">
          {uncountedVariants} product variant{uncountedVariants === 1 ? " has" : "s have"} never
          been counted into this store.
        </p>
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: "var(--color-primary)" }}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Count stock
        </Link>
      </div>
    </div>
  );
}
