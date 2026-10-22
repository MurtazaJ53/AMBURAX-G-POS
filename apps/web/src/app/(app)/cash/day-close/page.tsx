import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { CalendarCheck } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { listDayClose, todayIst } from "@/server/pos/cashRegister";
import { DataTable, EmptyState, KpiCard, PageHeader, PermissionDeniedState, StatusBadge, Td, Th } from "../../_components/ui";
import { formatTime } from "../../sales/formatDateTime";

const signed = (n: number) => (n === 0 ? "0" : `${n > 0 ? "+" : "−"}${formatMinor(Math.abs(n))}`);

/** Day close / reconciliation (screen 54): every shift of one day, what was taken and what was counted. */
export default async function DayClosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const raw = (await searchParams).date ?? "";
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("day close: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const today = todayIst();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  // Per-till takings are management data (latter.md Q27): owner and store manager.
  if (ctx.tenantRole !== "OWNER" && ctx.membershipRole !== "STORE_MANAGER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Day close" breadcrumb={[{ label: "Cash register", href: "/cash" }]} />
        <PermissionDeniedState title="Day close is for managers" description="The owner or a store manager reviews the day's tills." />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof listDayClose>>;
  try {
    data = await listDayClose({ tenantId: ctx.tenantId, storeId: ctx.storeId, date });
  } catch (err) {
    logError("day close: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const t = data.totals;
  const prev = new Date(new Date(`${date}T12:00:00+05:30`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const next = new Date(new Date(`${date}T12:00:00+05:30`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const nav = "amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50";
  const label = new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader title="Day close" subtitle={`${ctx.storeName} · ${label}`} breadcrumb={[{ label: "Cash register", href: "/cash" }]} />
      <nav aria-label="Day" className="mb-5 flex items-center gap-2">
        <Link href={`/cash/day-close?date=${prev}`} className={nav}>
          ← Previous day
        </Link>
        {date < today && (
          <Link href={`/cash/day-close?date=${next}`} className={nav}>
            Next day →
          </Link>
        )}
      </nav>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Bills" value={String(t.bills)} hint={`${data.registers.length} shifts`} />
        <KpiCard label="Cash taken" value={formatMinor(t.cash)} hint={`UPI ${formatMinor(t.upi)} · Card ${formatMinor(t.card)}`} tone="emerald" />
        <KpiCard
          label="Counted difference"
          value={t.difference === 0 ? "None" : signed(t.difference)}
          hint="Across counted shifts"
          tone={t.difference === 0 ? "blue" : "rose"}
        />
        <KpiCard
          label="Still to close"
          value={String(t.open + t.uncounted + t.awaitingApproval)}
          hint={`${t.open} open · ${t.uncounted} not counted · ${t.awaitingApproval} need approval`}
          tone={t.open + t.uncounted + t.awaitingApproval > 0 ? "amber" : "blue"}
        />
      </div>

      {data.registers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No shifts" description="No till was opened in this store on this day." />
        </div>
      ) : (
        <DataTable caption="Shifts this day">
          <thead>
            <tr>
              <Th>Till · cashier</Th>
              <Th>Hours</Th>
              <Th align="right">Bills</Th>
              <Th align="right">Expected cash</Th>
              <Th align="right">Counted</Th>
              <Th align="right">Difference</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.registers.map((r) => {
              const cash = r.counts.find((c) => c.method === "CASH");
              const diff = r.counts.reduce((a, c) => a + c.differenceMinor, 0);
              return (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/cash/${r.id}`} className="amb-focus rounded font-medium text-sky-700 hover:underline">
                      {r.posDevice.name}
                    </Link>
                    <span className="block text-xs text-slate-500">{r.cashier.name}</span>
                  </Td>
                  <Td>
                    {formatTime(r.openedAt)}–{r.closedAt ? formatTime(r.closedAt) : "now"}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {r.bills}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(cash?.expectedMinor ?? r.expected.CASH)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {cash ? formatMinor(cash.countedMinor) : "—"}
                  </Td>
                  <Td
                    align="right"
                    className={`font-semibold tabular-nums ${!r.countedAt ? "text-slate-500" : diff === 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {!r.countedAt ? "—" : signed(diff)}
                  </Td>
                  <Td>
                    {!r.closedAt ? (
                      <StatusBadge tone="warning">Open</StatusBadge>
                    ) : r.varianceStatus === "PENDING_APPROVAL" ? (
                      <StatusBadge tone="warning">Needs approval</StatusBadge>
                    ) : r.varianceStatus === "APPROVED" ? (
                      <StatusBadge tone="info">Difference approved</StatusBadge>
                    ) : r.countedAt ? (
                      <StatusBadge tone="success">Counted</StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">Not counted</StatusBadge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Differences add every method. Cash refunds aren&apos;t tied to a till, so they show on each shift&apos;s page, not here.
      </p>
    </div>
  );
}
