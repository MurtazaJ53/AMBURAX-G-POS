import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canViewReports } from "@/server/reports/salesReport";
import { formatMinor } from "@/server/sales/saleTotals";
import { AlertTriangle, CloudOff, IndianRupee, PackageMinus, Receipt, ShoppingBag, Users, Wallet } from "lucide-react";
import { getOperationsCenter } from "@/server/ops/operations";
import { Card, CardHeader, KpiCard, PageHeader, PermissionDeniedState, StatusBadge } from "../_components/ui";
import { formatTime } from "../sales/formatDateTime";

const FLAG_LABEL: Record<string, string> = { LATE: "late", HALF_DAY: "half day", NEEDS_REVIEW: "check punches", ABSENT: "absent" };

/**
 * Store Operations Center (screen 55): what needs a manager's eye right now, on one screen —
 * today's takings, open tills, who's in, low stock, held bills and everything waiting for approval.
 */
export default async function OperationsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("operations: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (!canViewReports(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Operations" />
        <PermissionDeniedState title="Operations is for owners and store managers" description="It shows takings and staff attendance." />
      </div>
    );
  }
  let data: Awaited<ReturnType<typeof getOperationsCenter>>;
  try {
    data = await getOperationsCenter({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("operations: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const m = data.metrics;
  const waiting = data.approvals.corrections + data.approvals.leave + data.approvals.variances;
  const tasks = [
    { n: data.approvals.variances, label: "till differences to approve", href: "/cash/day-close" },
    { n: data.approvals.corrections, label: "attendance corrections", href: "/staff/attendance" },
    { n: data.approvals.leave, label: "leave requests", href: "/staff/leave" },
    { n: data.lowStock, label: "items running low", href: "/inventory?status=low_stock" },
    { n: data.failedSyncs, label: "Accounting syncs failed", href: "/settings/system-health" },
  ].filter((t) => t.n > 0);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Operations" subtitle={`${ctx.storeName} · today`} />

      <section aria-label="Today" className="amb-fade-in grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sales today" value={formatMinor(m.salesMinor)} hint={`${m.billCount} ${m.billCount === 1 ? "bill" : "bills"}`} icon={<IndianRupee className="h-5 w-5" />} />
        <KpiCard label="Average bill" value={m.averageBillMinor == null ? "—" : formatMinor(m.averageBillMinor)} icon={<Receipt className="h-5 w-5" />} />
        <KpiCard label="Team in now" value={`${data.team.in.length} of ${data.team.total}`} icon={<Users className="h-5 w-5" />} tone="emerald" />
        <KpiCard label="Waiting for you" value={String(waiting)} hint="approvals" icon={<AlertTriangle className="h-5 w-5" />} tone={waiting > 0 ? "amber" : "emerald"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="amb-fade-in">
          <CardHeader title="Needs attention" subtitle="Everything here links to where you act on it." />
          <div className="px-5 pb-5">
            {tasks.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-800">
                <StatusBadge tone="success">All clear</StatusBadge> Nothing is waiting.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <li key={t.label} className="amb-line-in">
                    <Link href={t.href} className="amb-focus flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
                      <span className="text-slate-800">
                        <span className="mr-2 font-semibold tabular-nums text-slate-900">{t.n}</span>
                        {t.label}
                      </span>
                      <span aria-hidden="true" className="text-sky-700">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="amb-fade-in">
          <CardHeader title="Tills" subtitle={`${data.openTills.length} open · ${data.heldBills} held ${data.heldBills === 1 ? "bill" : "bills"}`} />
          <div className="px-5 pb-5">
            {data.openTills.length === 0 ? (
              <p className="text-sm text-slate-600">No till is open.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.openTills.map((t) => (
                  <li key={t.id} className="amb-line-in flex min-h-11 items-center justify-between gap-3 py-2">
                    <span className="flex items-center gap-2">
                      <Wallet aria-hidden="true" className="h-4 w-4 text-slate-500" />
                      <span className="font-medium text-slate-900">{t.till}</span>
                      <span className="text-slate-600">{t.cashier}</span>
                    </span>
                    <Link href={`/cash/${t.id}`} className="amb-focus inline-flex min-h-11 items-center rounded px-2 text-sky-700 hover:bg-sky-50">
                      open since {formatTime(t.openedAt)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="amb-fade-in">
          <CardHeader title="Team" subtitle="From today's punches and published shifts." />
          <div className="space-y-3 px-5 pb-5 text-sm">
            <p className="text-slate-700">
              <span className="font-medium text-slate-900">In now:</span> {data.team.in.length > 0 ? data.team.in.join(", ") : "nobody"}
            </p>
            {data.team.flagged.length > 0 && (
              <ul className="space-y-1">
                {data.team.flagged.map((f) => (
                  <li key={f.name} className="text-slate-700">
                    <span className="font-medium text-slate-900">{f.name}</span>: {f.flags.map((x) => FLAG_LABEL[x] ?? x).join(", ")}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/staff/attendance" className="amb-focus inline-flex min-h-11 items-center font-semibold text-sky-700">
              Attendance →
            </Link>
          </div>
        </Card>

        <Card className="amb-fade-in">
          <CardHeader title="Stock" />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 text-sm">
            <Link href="/inventory?status=low_stock" className="amb-focus amb-lift flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <PackageMinus aria-hidden="true" className="h-5 w-5 text-amber-700" />
              <span>
                <span className="block text-lg font-semibold tabular-nums text-slate-900">{data.lowStock}</span>
                running low
              </span>
            </Link>
            <Link href="/inventory/reservations" className="amb-focus amb-lift flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <ShoppingBag aria-hidden="true" className="h-5 w-5 text-sky-700" />
              <span>
                <span className="block text-lg font-semibold text-slate-900">Reserved</span>
                for orders
              </span>
            </Link>
            {data.failedSyncs > 0 && (
              <Link href="/settings/system-health" className="amb-focus col-span-2 flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                <CloudOff aria-hidden="true" className="h-5 w-5" />
                {data.failedSyncs} {data.failedSyncs === 1 ? "record hasn't" : "records haven't"} reached accounting
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
