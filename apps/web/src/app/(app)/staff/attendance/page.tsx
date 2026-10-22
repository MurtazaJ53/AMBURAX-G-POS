import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { Clock } from "lucide-react";
import { canSeeEveryone, listCorrections, roster, type AttendanceFlag } from "@/server/staff/attendance";
import { DecideCorrection, RequestCorrection } from "./CorrectionForms";
import { todayIst } from "@/server/pos/cashRegister";
import { DataTable, EmptyState, KpiCard, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatTime } from "../../sales/formatDateTime";
import { ROLE_LABEL } from "../roleLabels";
import { PunchButton } from "./PunchButton";

const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

const FLAG: Record<AttendanceFlag, { label: string; tone: "warning" | "danger" }> = {
  LATE: { label: "Late", tone: "warning" },
  HALF_DAY: { label: "Half day", tone: "warning" },
  NEEDS_REVIEW: { label: "Check punches", tone: "danger" },
  ABSENT: { label: "Absent", tone: "danger" },
};

/** Attendance (screen 51): who is in today, and your own clock in / out. */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const raw = (await searchParams).date ?? "";
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("attendance: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const today = todayIst();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  const actor = { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole };

  let rows: Awaited<ReturnType<typeof roster>>;
  let everyone: boolean;
  let me: Awaited<ReturnType<typeof roster>>[number] | undefined;
  let corrections: Awaited<ReturnType<typeof listCorrections>> = [];
  try {
    everyone = await canSeeEveryone(actor, ctx.storeId);
    rows = await roster({ tenantId: ctx.tenantId, storeId: ctx.storeId, date, onlyUserId: everyone ? undefined : ctx.userId });
    me =
      date === today
        ? (await roster({ tenantId: ctx.tenantId, storeId: ctx.storeId, date: today, onlyUserId: ctx.userId }))[0]
        : undefined;
    corrections = await listCorrections({ tenantId: ctx.tenantId, storeId: ctx.storeId, onlyUserId: everyone ? undefined : ctx.userId });
  } catch (err) {
    logError("attendance: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const inNow = rows.filter((r) => r.state === "in").length;
  const prev = new Date(new Date(`${date}T12:00:00+05:30`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const nav = "amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50";

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Attendance"
        subtitle={`${ctx.storeName} · ${date === today ? "today" : date}`}
        breadcrumb={[{ label: "Staff", href: "/staff" }]}
        actions={date === today ? <PunchButton clockedIn={me?.state === "in"} /> : undefined}
      />
      <nav aria-label="Day" className="mb-5 flex items-center gap-2">
        <Link href={`/staff/attendance?date=${prev}`} className={nav}>
          ← Previous day
        </Link>
        {date < today && (
          <Link href="/staff/attendance" className={nav}>
            Today
          </Link>
        )}
      </nav>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="In now" value={String(date === today ? inNow : 0)} hint={date === today ? "Clocked in" : "Past day"} tone="emerald" />
        <KpiCard label="Came in" value={String(rows.filter((r) => r.firstIn).length)} hint={`of ${rows.length} shown`} />
        <KpiCard label="Hours" value={hours(rows.reduce((s, r) => s + r.minutes, 0))} hint="Clocked time, people shown" tone="violet" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<Clock className="h-5 w-5" />} title="No team yet" description="People appear here once they join this store." />
        </div>
      ) : (
        <DataTable caption="Attendance">
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>First in</Th>
              <Th>Last out</Th>
              <Th>Shift</Th>
              <Th align="right">Hours</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <Td>
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="block text-xs text-slate-500">{ROLE_LABEL[r.role] ?? r.role}</span>
                </Td>
                <Td>{r.firstIn ? formatTime(r.firstIn) : "—"}</Td>
                <Td>{r.lastOut ? formatTime(r.lastOut) : "—"}</Td>
                <Td>
                  {r.shift ? (
                    <>
                      {formatTime(r.shift.startAt)}–{formatTime(r.shift.endAt)}
                      {r.shift.changedAfterPublishAt && <span className="block text-xs text-amber-800">Changed after publishing</span>}
                    </>
                  ) : (
                    <span className="text-slate-500">Not planned</span>
                  )}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.minutes > 0 ? hours(r.minutes) : "—"}
                </Td>
                <Td>
                  {r.state === "in" ? (
                    <StatusBadge tone="success">In</StatusBadge>
                  ) : r.state === "out" ? (
                    <StatusBadge tone="neutral">Out</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Not in</StatusBadge>
                  )}
                  {r.flags.map((f) => (
                    <span key={f} className="ml-1">
                      <StatusBadge tone={FLAG[f].tone}>{FLAG[f].label}</StatusBadge>
                    </span>
                  ))}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <section aria-labelledby="corrections" className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="corrections" className="text-base font-semibold text-slate-900">
            Corrections
          </h2>
          <RequestCorrection
            date={date}
            selfId={ctx.userId}
            people={everyone ? rows.map((r) => ({ id: r.userId, name: r.name })) : []}
            punches={rows.flatMap((r) =>
              r.punches.map((p) => ({
                id: p.id,
                userId: r.userId,
                label: `${r.name}: ${p.logType === "IN" ? "in" : "out"} at ${formatTime(p.at)}`,
              })),
            )}
          />
        </div>
        {corrections.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">No correction requests.</p>
        ) : (
          <DataTable caption="Correction requests">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Asked for</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Decide</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{c.name}</span>
                    {c.requestedByUserId !== c.userId && <span className="block text-xs text-slate-500">asked by {c.requestedBy}</span>}
                  </Td>
                  <Td>
                    {c.logType === "IN" ? "Clock in" : "Clock out"} at {formatTime(c.correctedAt)}
                    {c.originalCheckinId && <span className="block text-xs text-slate-500">replaces a punch</span>}
                  </Td>
                  <Td>{c.reason}</Td>
                  <Td>
                    {c.status === "PENDING" ? (
                      <StatusBadge tone="warning">Waiting</StatusBadge>
                    ) : c.status === "APPROVED" ? (
                      <StatusBadge tone="success">Approved</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Rejected</StatusBadge>
                    )}
                  </Td>
                  <Td align="right">
                    {everyone && c.status === "PENDING" && c.userId !== ctx.userId && c.requestedByUserId !== ctx.userId ? (
                      <DecideCorrection id={c.id} />
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {!everyone && (
        <p className="mt-4 text-xs text-slate-500">You see your own times. The owner and store managers see the whole team.</p>
      )}
    </div>
  );
}
