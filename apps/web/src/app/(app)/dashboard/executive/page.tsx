import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { PageHeader } from "../../_components/ui";
import {
  TrendingUp,
  DollarSign,
  Users,
  ShoppingBag,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  Smartphone,
  Flame,
  CreditCard,
  Building2,
  Calendar
} from "lucide-react";

export const metadata = {
  title: "Executive Mobile Command Center — AMBURAX POS",
};

export default async function ExecutiveMobileCenterPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("executive:center: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  // Real-time aggregates for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [salesToday, recentSales, activeSessions, topProducts] = await Promise.all([
    db.sale.aggregate({
      where: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        status: "COMPLETED",
        createdAt: { gte: today },
      },
      _sum: { totalMinor: true, subtotalMinor: true, discountMinor: true },
      _count: { id: true },
    }),
    db.sale.findMany({
      where: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { customer: { select: { name: true } } },
    }),
    db.posSession.findMany({
      where: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        closedAt: null,
      },
      include: { cashier: { select: { name: true } } },
    }),
    db.saleItem.groupBy({
      by: ["nameSnapshot", "skuSnapshot"],
      where: {
        sale: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          status: "COMPLETED",
        },
      },
      _sum: { quantity: true, lineTotalMinor: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);

  const totalTakingsMinor = salesToday._sum.totalMinor ?? 0;
  const billCount = salesToday._count.id ?? 0;
  const avgBasketMinor = billCount > 0 ? Math.round(totalTakingsMinor / billCount) : 0;
  const totalDiscountMinor = salesToday._sum.discountMinor ?? 0;

  return (
    <div className="mx-auto max-w-lg px-4 py-6 sm:px-6 space-y-6">
      {/* Mobile Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md">
            <Smartphone className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-950">Executive Command</h1>
            <p className="text-[11px] font-medium text-slate-500">{ctx.storeName} · Live</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-600/20">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          REALTIME
        </span>
      </div>

      {/* Primary KPI Hero Card */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
          <TrendingUp className="h-48 w-48 text-white" />
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Today&apos;s Store Takings</p>
        <p className="mt-2 text-3xl font-black font-mono tracking-tight">{formatMinor(totalTakingsMinor)}</p>
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-xs">
          <div>
            <span className="text-slate-400">Bills Cleared:</span>{" "}
            <span className="font-bold text-white">{billCount}</span>
          </div>
          <div>
            <span className="text-slate-400">Avg Ticket:</span>{" "}
            <span className="font-bold font-mono text-white">{formatMinor(avgBasketMinor)}</span>
          </div>
        </div>
      </div>

      {/* Till Cashier Sessions & Live Registers */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <CreditCard className="h-4 w-4 text-slate-400" /> Active Cash Registers ({activeSessions.length})
          </h2>
          <Link href="/till" className="text-xs font-semibold text-sky-700 hover:underline">
            View Tills
          </Link>
        </div>

        {activeSessions.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center bg-slate-50 rounded-xl">No active registers currently open.</p>
        ) : (
          <div className="space-y-2">
            {activeSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
                <div>
                  <p className="font-bold text-slate-900">{s.cashier?.name ?? "Register Cashier"}</p>
                  <p className="text-[11px] text-slate-500 font-mono">Session: {s.id.slice(-6)}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  OPEN
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fast Velocity / Top Selling SKUs */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-orange-500" /> Velocity Leaders Today
          </h2>
          <Link href="/inventory" className="text-xs font-semibold text-sky-700 hover:underline">
            Stock
          </Link>
        </div>

        <div className="divide-y divide-slate-100">
          {topProducts.map((p, idx) => (
            <div key={idx} className="flex items-center justify-between py-2.5 text-xs">
              <div className="min-w-0 pr-3">
                <p className="truncate font-bold text-slate-900">{p.nameSnapshot}</p>
                <p className="text-[11px] font-mono text-slate-400">{p.skuSnapshot}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono font-bold text-slate-900">{p._sum.quantity} pcs</span>
                <p className="text-[11px] text-slate-500">{formatMinor(p._sum.lineTotalMinor ?? 0)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Recent Transactions Feed */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-slate-400" /> Real-Time Inward Bills
          </h2>
          <Link href="/sales" className="text-xs font-semibold text-sky-700 hover:underline">
            All Bills
          </Link>
        </div>

        <div className="divide-y divide-slate-100">
          {recentSales.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2.5 text-xs">
              <div>
                <p className="font-mono font-bold text-slate-900">{s.billNumber}</p>
                <p className="text-[11px] text-slate-500">{s.customer?.name || "Walk-in Guest"}</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-slate-900">{formatMinor(s.totalMinor)}</span>
                <p className="text-[10px] text-slate-400">{new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
