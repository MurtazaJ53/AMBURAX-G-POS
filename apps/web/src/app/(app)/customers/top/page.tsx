import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Trophy, TrendingUp, Users, ShoppingBag, ArrowUpRight, Calendar, Filter, Sparkles } from "lucide-react";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateOnly } from "../../sales/formatDateTime";
import {
  getTopCustomers,
  isTopCustomerWindow,
  TOP_CUSTOMER_WINDOWS,
  type TopCustomerWindow,
} from "@/server/sales/topCustomers";
import { CustomerAvatar, SegmentPill } from "../customerUi";
import type { CustomerType } from "@prisma/client";

export default async function TopCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; metric?: string }>;
}) {
  const sp = await searchParams;
  const requestedDays = Number(sp.days);
  const days: TopCustomerWindow = isTopCustomerWindow(requestedDays) ? requestedDays : 90;
  const metric = sp.metric === "visits" ? "visits" : "spend";

  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return redirect("/auth/login");

  const ctx = await resolvePosContext(token);
  if (ctx.status !== "ok") return redirect("/auth/login");

  const data = await getTopCustomers({
    tenantId: ctx.context.tenantId,
    days,
    metric,
    limit: 50,
  });

  const hrefWith = (newParams: { days?: number; metric?: "spend" | "visits" }) => {
    const q = new URLSearchParams({
      days: String(newParams.days ?? days),
      metric: newParams.metric ?? metric,
    });
    return `/customers/top?${q.toString()}`;
  };

  const isOwnerOrManager = ctx.context.tenantRole === "OWNER" || ctx.context.membershipRole === "STORE_MANAGER";

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 space-y-6">
      {/* Header & Controls */}
      <div className="cust-rise flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200">
              <Trophy className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Top Customers Leaderboard</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            High-value shoppers and repeat clientele ranked by actual completed store spend (Screen C2 / 38-40)
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs">
            <Link
              href={hrefWith({ metric: "spend" })}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                metric === "spend"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5 text-sky-400" />
              Highest Spend
            </Link>
            <Link
              href={hrefWith({ metric: "visits" })}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                metric === "visits"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5 text-amber-400" />
              Most Visits
            </Link>
          </div>

          {/* Time Window Buttons */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs">
            {TOP_CUSTOMER_WINDOWS.map((w) => (
              <Link
                key={w}
                href={hrefWith({ days: w })}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                  days === w
                    ? "bg-sky-50 text-sky-700 font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {w} Days
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="cust-rise rounded-xl border border-slate-200 bg-white p-4 shadow-xs" style={{ ["--i" as string]: 1 }}>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Attributed Revenue</span>
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 font-bold">In Window</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatMinor(data.totalAttributedRevenueMinor).replace(/\.00$/, "")}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">From {data.totalActiveCustomers} returning customers</p>
        </div>

        <div className="cust-rise rounded-xl border border-slate-200 bg-white p-4 shadow-xs" style={{ ["--i" as string]: 2 }}>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Completed Bills</span>
            <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 font-bold">{days} Days</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {data.totalAttributedBills.toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Avg. {data.totalActiveCustomers > 0 ? (data.totalAttributedBills / data.totalActiveCustomers).toFixed(1) : 0} visits per customer
          </p>
        </div>

        <div className="cust-rise rounded-xl border border-slate-200 bg-white p-4 shadow-xs" style={{ ["--i" as string]: 3 }}>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Average Ticket Size</span>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 font-bold">AOV</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {data.totalAttributedBills > 0
              ? formatMinor(Math.round(data.totalAttributedRevenueMinor / data.totalAttributedBills)).replace(/\.00$/, "")
              : "—"}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Average spend per visit</p>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="cust-rise overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" style={{ ["--i" as string]: 4 }}>
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-900">Ranked VIP Clients</span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {data.rows.length}
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Sorted by {metric === "spend" ? "total gross spend" : "completed bills"}
          </span>
        </div>

        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No completed sales with attached customers recorded in the selected {days}-day window.
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase">
                  <th className="py-3 px-4 w-12 text-center">Rank</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Segment</th>
                  <th className="py-3 px-4 text-center">Visits</th>
                  <th className="py-3 px-4 text-right">Avg Basket</th>
                  <th className="py-3 px-4 text-right">Total Spend</th>
                  <th className="py-3 px-4">Last Visit</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 text-center">
                      {row.rank === 1 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-800 text-[11px]">
                          🥇
                        </span>
                      ) : row.rank === 2 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700 text-[11px]">
                          🥈
                        </span>
                      ) : row.rank === 3 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 font-bold text-amber-700 text-[11px]">
                          🥉
                        </span>
                      ) : (
                        <span className="font-mono text-slate-400 font-medium">#{row.rank}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <CustomerAvatar id={row.id} name={row.name} size="sm" />
                        <div>
                          <div className="font-bold text-slate-900">{row.name}</div>
                          {row.phone && (
                            <div className="font-mono text-[10px] text-slate-500">
                              {isOwnerOrManager ? row.phone : `${row.phone.slice(0, 2)}XXXXXX${row.phone.slice(-2)}`}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <SegmentPill segment={row.customerType} />
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-800">
                      {row.totalBills}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">
                      {formatMinor(row.avgBasketMinor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                      {formatMinor(row.totalSpentMinor).replace(/\.00$/, "")}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {row.lastPurchaseAt ? formatDateOnly(row.lastPurchaseAt) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/customers?selected=${row.id}`}
                        className="amb-press inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50"
                      >
                        Profile
                        <ArrowUpRight className="h-3 w-3 text-slate-400" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
