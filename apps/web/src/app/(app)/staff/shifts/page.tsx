import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { MonitorSmartphone } from "lucide-react";
import { listDayClose, todayIst } from "@/server/pos/cashRegister";
import { listPlans, PLAN_HORIZON_DAYS } from "@/server/staff/shiftPlans";
import { db } from "@/server/db";
import { ShiftPlanner } from "./ShiftPlanner";
import { ShiftRowActions } from "./ShiftRowActions";
import { DataTable, EmptyState, PageHeader, PermissionDeniedState, StatusBadge, Td, Th } from "../../_components/ui";
import { formatTime } from "../../sales/formatDateTime";
import { formatMinor } from "@/server/sales/saleTotals";

const length = (from: Date, to: Date | null) => {
  if (!to) return "Running";
  const m = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

/**
 * Shift management (screen 52): plan and publish shifts up to 14 days ahead (E5), and see every till
 * shift of one day — who ran which till, when, for how long.
 */
export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const raw = (await searchParams).date ?? "";
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("shifts: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const today = todayIst();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  if (ctx.tenantRole !== "OWNER" && ctx.membershipRole !== "STORE_MANAGER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Shifts" breadcrumb={[{ label: "Staff", href: "/staff" }]} />
        <PermissionDeniedState title="Shifts are for managers" description="The owner or a store manager sees every till shift." />
      </div>
    );
  }
  let data: Awaited<ReturnType<typeof listDayClose>>;
  let plans: Awaited<ReturnType<typeof listPlans>>;
  let people: { id: string; name: string }[];
  try {
    data = await listDayClose({ tenantId: ctx.tenantId, storeId: ctx.storeId, date });
    const from = new Date(`${today}T00:00:00+05:30`);
    plans = await listPlans({
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      from,
      to: new Date(from.getTime() + (PLAN_HORIZON_DAYS + 1) * 86_400_000),
      includeDrafts: true,
    });
    people = (
      await db.storeMembership.findMany({
        where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
        orderBy: { user: { name: "asc" } },
        select: { user: { select: { id: true, name: true } } },
      })
    ).map((m) => m.user);
  } catch (err) {
    logError("shifts: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const prev = new Date(new Date(`${date}T12:00:00+05:30`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const nav = "amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50";

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Shifts"
        subtitle={`Till shifts in ${ctx.storeName} · ${date === today ? "today" : date}`}
        breadcrumb={[{ label: "Staff", href: "/staff" }]}
      />
      <nav aria-label="Day" className="mb-5 flex items-center gap-2">
        <Link href={`/staff/shifts?date=${prev}`} className={nav}>
          ← Previous day
        </Link>
        {date < today && (
          <Link href="/staff/shifts" className={nav}>
            Today
          </Link>
        )}
      </nav>
      <ShiftPlanner
        plans={plans.map((p) => ({ id: p.id, name: p.name, startAt: p.startAt.toISOString(), endAt: p.endAt.toISOString(), breakMinutes: p.breakMinutes, status: p.status }))}
        people={people}
      />

      <h2 className="mb-3 mt-8 text-base font-semibold text-slate-900">Till shifts that day</h2>
      {data.registers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<MonitorSmartphone className="h-5 w-5" />} title="No shifts" description="No till was opened on this day." />
        </div>
      ) : (
        <DataTable caption="Till shifts">
          <thead>
            <tr>
              <Th>Cashier</Th>
              <Th>Till</Th>
              <Th>From – to</Th>
              <Th align="right">Length</Th>
              <Th align="right">Bills</Th>
              <Th align="right">Difference</Th>
              <Th>Variance / Sync</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.registers.map((r) => {
              const diff = r.counts.reduce((a, c) => a + c.differenceMinor, 0);
              return (
                <tr key={r.id}>
                  <Td className="font-medium text-slate-900">{r.cashier.name}</Td>
                  <Td>
                    {r.posDevice.name} <span className="font-mono text-xs text-slate-500">{r.posDevice.code}</span>
                  </Td>
                  <Td>
                    {formatTime(r.openedAt)} – {r.closedAt ? formatTime(r.closedAt) : "now"}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {length(r.openedAt, r.closedAt)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {r.bills}
                  </Td>
                  <Td align="right" className={`tabular-nums font-mono font-semibold ${diff === 0 ? "text-slate-500" : diff > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {r.counts.length === 0 ? "—" : diff === 0 ? "₹0" : (diff > 0 ? `+${formatMinor(diff)}` : formatMinor(diff))}
                  </Td>
                  <Td>
                    {r.varianceStatus === "APPROVED" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 border border-purple-200">
                        Posting: {r.variancePostingStatus ?? "Cash Short/Over"}
                      </span>
                    ) : r.varianceStatus === "PENDING_APPROVAL" ? (
                      <span className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                        Needs approval
                      </span>
                    ) : r.counts.length > 0 ? (
                      <span className="text-[11px] text-slate-400 font-medium">Balanced</span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Uncounted</span>
                    )}
                  </Td>
                  <Td>
                    {!r.closedAt ? <StatusBadge tone="success">On till</StatusBadge> : <StatusBadge tone="neutral">Closed</StatusBadge>}
                  </Td>
                  <Td align="right">
                    <ShiftRowActions
                      session={{
                        id: r.id,
                        openedAt: r.openedAt,
                        closedAt: r.closedAt,
                        cashierName: r.cashier.name,
                        posDeviceName: r.posDevice.name,
                        posDeviceCode: r.posDevice.code,
                        openingFloatMinor: r.openingFloatMinor,
                        billsCount: r.bills,
                        varianceStatus: r.varianceStatus,
                        expectedCashMinor: r.expected.CASH,
                        expectedUpiMinor: r.expected.UPI,
                        expectedCardMinor: r.expected.CARD,
                        counts: r.counts,
                        closingNote: r.closingNote,
                      }}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
