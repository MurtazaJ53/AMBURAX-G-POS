import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { canSeeEveryone } from "@/server/staff/attendance";
import { listLeave } from "@/server/staff/leave";
import { todayIst } from "@/server/pos/cashRegister";
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { DecideLeave, RequestLeave, WithdrawLeave } from "./LeaveForms";

const STATUS: Record<string, { label: string; tone: "warning" | "success" | "neutral" }> = {
  PENDING: { label: "Waiting", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
};

const span = (from: string, to: string, half: boolean) => {
  const f = (d: string) =>
    new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  if (half) return `${f(from)} (half day)`;
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
};

/**
 * Leave (E5): ask for days off or mark days you can't work; a manager other than you approves.
 * Approved full days block shift planning. Moves to HRMS Leave Application when HRMS is added.
 */
export default async function LeavePage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("leave: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  const actor = { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole };
  const today = todayIst();

  let everyone: boolean;
  let rows: Awaited<ReturnType<typeof listLeave>>;
  let people: { id: string; name: string }[] = [];
  try {
    everyone = await canSeeEveryone(actor, ctx.storeId);
    rows = await listLeave({ tenantId: ctx.tenantId, storeId: ctx.storeId, fromDate: today, onlyUserId: everyone ? undefined : ctx.userId });
    if (everyone) {
      people = (
        await db.storeMembership.findMany({
          where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
          orderBy: { user: { name: "asc" } },
          select: { user: { select: { id: true, name: true } } },
        })
      ).map((m) => m.user);
    }
  } catch (err) {
    logError("leave: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const waiting = rows.filter((r) => r.status === "PENDING").length;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Leave"
        subtitle={everyone ? `${ctx.storeName} · ${waiting} waiting for a decision` : "Your leave and days you can't work"}
        breadcrumb={[{ label: "Staff", href: "/staff" }]}
      />

      <Card>
        <CardHeader title="Ask for time off" subtitle="Approved full days stop shifts being planned on them." />
        <div className="px-5 pb-5">
          <RequestLeave today={today} selfId={ctx.userId} people={people} />
        </div>
      </Card>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">No upcoming leave.</p>
      ) : (
        <DataTable caption="Upcoming leave">
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Dates</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const canDecide = everyone && r.status === "PENDING" && r.userId !== ctx.userId && r.requestedByUserId !== ctx.userId;
              const canWithdraw = (r.userId === ctx.userId || everyone) && r.status !== "REJECTED" && r.fromDate > today;
              return (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{r.name}</span>
                    {r.requestedByUserId !== r.userId && <span className="block text-xs text-slate-500">asked by {r.requestedBy}</span>}
                  </Td>
                  <Td>
                    {span(r.fromDate, r.toDate, r.halfDay)}
                    <span className="block text-xs text-slate-500">{r.kind === "UNAVAILABLE" ? "Can't work" : "Leave"}</span>
                  </Td>
                  <Td>
                    {r.reason}
                    {r.decisionNote && <span className="block text-xs text-slate-500">Note: {r.decisionNote}</span>}
                  </Td>
                  <Td>
                    <StatusBadge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</StatusBadge>
                  </Td>
                  <Td align="right">
                    {canDecide ? <DecideLeave id={r.id} /> : canWithdraw ? <WithdrawLeave id={r.id} /> : null}
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
