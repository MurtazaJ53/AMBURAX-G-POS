import * as React from "react";
import Link from "next/link";
import { Activity, ChevronRight } from "lucide-react";
import type {
  DashboardShiftActivity,
  DashboardStockSignal,
} from "@/server/dashboard/dashboardQueries";

/** "Priya Nair" → "PN"; a single name gives its first two letters. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Who is on a till right now. Only what the system knows: open till sessions and the people on
 * them. There is no break or attendance model, so none is shown.
 */
export function ShiftStatusCard({ activity }: { activity: DashboardShiftActivity }) {
  const open = activity.openSessions;
  return (
    <div className="surface-card rounded-lg p-4 flex flex-col h-full">
      <h2 className="text-[13px] font-bold text-slate-800">Store staff</h2>
      <p className={`mt-1 flex items-center gap-1 text-[10px] font-semibold ${open > 0 ? "text-emerald-700" : "text-slate-500"}`}>
        <span aria-hidden="true" className={`size-1.5 rounded-full ${open > 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
        {open > 0 ? `${open} ${open === 1 ? "till" : "tills"} open` : "No till open"}
      </p>
      {activity.cashiers.length > 0 && (
        <>
          <div className="mt-auto flex items-end gap-1.5 pt-3" aria-hidden="true">
            {activity.cashiers.slice(0, 5).map((c) => (
              <div key={c.userId} className="size-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600">
                {initialsOf(c.name)}
              </div>
            ))}
            {activity.cashiers.length > 5 && (
              <div className="size-7 rounded-full bg-slate-50 flex items-center justify-center text-[9px] font-bold text-slate-500">
                +{activity.cashiers.length - 5}
              </div>
            )}
          </div>
          <p className="mt-1.5 truncate text-[10px] text-slate-500">
            On shift: {activity.cashiers.map((c) => c.name).join(", ")}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Today's pace against this store's own average day over the last 30 days. There is no target
 * setting yet, so nothing is invented: with no history the card says so plainly.
 */
export function TargetsCard({
  metrics,
  averageDayMinor = null,
}: {
  metrics?: { salesMinor: number; billCount: number };
  averageDayMinor?: number | null;
}) {
  if (!averageDayMinor || averageDayMinor <= 0) {
    return (
      <div className="surface-card rounded-lg p-4 flex flex-col h-full justify-between">
        <h2 className="text-[13px] font-bold text-slate-800">Today&apos;s pace</h2>
        <div className="my-3">
          <p className="text-[12px] font-semibold text-slate-700">No target configured</p>
          <p className="mt-1 text-[10px] text-slate-500">
            AMBURAX cannot set or store sales targets yet. Once this store has 30 days of sales, today is compared with its average day.
          </p>
        </div>
        <span className="text-[10px] text-slate-500">{metrics?.billCount || 0} bills rung today</span>
      </div>
    );
  }
  const targetMinor = averageDayMinor;
  const currentSalesMinor = metrics?.salesMinor || 0;
  const percent = Math.min(100, Math.round((currentSalesMinor / targetMinor) * 100));
  const currentRupees = (currentSalesMinor / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
  const targetRupees = (targetMinor / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });

  return (
    <div className="surface-card rounded-lg p-4 flex flex-col h-full justify-between">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold text-slate-800">Today&apos;s pace</h2>
        <span className="text-[9px] font-semibold text-emerald-700 uppercase tracking-wide bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
          {percent}% of an average day
        </span>
      </div>

      <div className="my-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-bold text-slate-900 text-sm">₹{currentRupees}</span>
          <span className="text-slate-500 text-[11px]">Average day: ₹{targetRupees}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${Math.max(5, percent)}%` }}
          />
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span>{metrics?.billCount || 0} bills rung today</span>
        <span className="font-semibold text-slate-700">Last 30 days</span>
      </div>
    </div>
  );
}

export function SystemStatusCard({
  activity,
  stock,
  erpConnected = false,
}: {
  activity: DashboardShiftActivity;
  stock: DashboardStockSignal;
  /** True only when this business's ERPNext company is provisioned. Never assumed. */
  erpConnected?: boolean;
}) {
  const healthy = activity.openSessions > 0 && stock.uncountedVariants === 0;

  return (
    <div className={`surface-card rounded-lg p-4 flex flex-col h-full ${healthy ? "bg-emerald-50/70" : "bg-slate-50/70"}`}>
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-full text-white ${healthy ? "bg-emerald-500" : "bg-slate-400"}`}>
          <Activity size={14} />
        </span>
        <div>
          {/* Observable facts only — the system cannot vouch for "all systems operational". */}
          <h2 className={`text-[12px] font-bold ${healthy ? "text-emerald-900" : "text-slate-700"}`}>
            Store status
          </h2>
          <p className={`mt-1 text-[9px] ${healthy ? "text-emerald-700" : "text-slate-500"}`}>
            POS &middot; Inventory &middot; Sync &middot; Payments
          </p>
        </div>
      </div>
      <div className={`mt-4 flex flex-col gap-1 text-[9px] flex-1 justify-end ${healthy ? "text-emerald-700" : "text-slate-500"}`}>
        <div className="flex justify-between border-b border-white/40 pb-1">
          <span>Till sessions:</span>
          <span className="font-semibold">{activity.openSessions > 0 ? `${activity.openSessions} open` : "None open"}</span>
        </div>
        <div className="flex justify-between border-b border-white/40 pb-1">
          <span>Stock counted:</span>
          <span className="font-semibold">{stock.uncountedVariants === 0 ? "All variants counted" : `${stock.uncountedVariants} without a count`}</span>
        </div>
        <div className="flex justify-between pt-0.5">
          <span>Accounting:</span>
          <span className={`font-semibold ${erpConnected ? "text-emerald-800" : "text-slate-600"}`}>
            {erpConnected ? "Connected (Backend)" : "Not connected"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function NextStepBanner({ uncountedVariants }: { uncountedVariants: number }) {
  const count = Math.max(0, Math.trunc(uncountedVariants));
  return (
    <div className="surface-card flex min-h-[92px] items-center gap-4 overflow-hidden rounded-lg bg-sky-50/30 p-4 h-full">
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-bold text-slate-800">Stock counts to review</h2>
        <p className="mt-1 text-[12px] text-slate-600">
          {count === 1 ? "1 active variant has no stock count." : `${count} active variants have no stock count.`}
        </p>
        <Link href="/inventory" className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-sky-800 hover:bg-sky-100">
          Open inventory <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
