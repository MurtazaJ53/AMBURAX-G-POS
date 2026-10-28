import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { canHandleCash, getRegister } from "@/server/pos/cashRegister";
import { listApprovers } from "@/server/identity/approvalPin";
import { db } from "@/server/db";
import { Card, CardHeader, KpiCard, PageHeader, StatusBadge } from "../../_components/ui";
import { formatDateTime, formatTime } from "../../sales/formatDateTime";
import { ApproveVarianceForm, CloseCountForm, FloatForm, MovementForm } from "../RegisterForms";
import { canApproveInStore } from "@/server/identity/approvalPin";

const METHOD = { CASH: "Cash", UPI: "UPI", CARD: "Card" } as const;

/** One till's drawer for one shift (screens 53-54). */
export default async function RegisterPage(props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("register: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let reg: Awaited<ReturnType<typeof getRegister>>;
  let canAct = false;
  let approvers: { id: string; name: string; owner: boolean }[] = [];
  let canApprove = false;
  try {
    reg = await getRegister({ tenantId: ctx.tenantId, sessionId });
    if (reg) canAct = await canHandleCash({ tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole }, reg);
    if (reg) canApprove = await canApproveInStore({ tenantId: ctx.tenantId, storeId: reg.storeId, userId: ctx.userId });
    if (reg && canAct) {
      const list = await listApprovers({ tenantId: ctx.tenantId, storeId: reg.storeId });
      const owners = await db.user.findMany({
        where: { tenantId: ctx.tenantId, tenantRole: "OWNER", id: { in: list.map((a) => a.id) } },
        select: { id: true },
      });
      const ownerIds = new Set(owners.map((u) => u.id));
      approvers = list.map((a) => ({ ...a, owner: ownerIds.has(a.id) }));
    }
  } catch (err) {
    logError("register: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  // Tenant-scoped: another tenant's shift is a 404.
  if (!reg) notFound();
  const open = !reg.closedAt;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={`${reg.posDevice.name} · ${reg.cashier.name}`}
        subtitle={`${reg.store.name} · opened ${formatDateTime(reg.openedAt)}${reg.closedAt ? ` · closed ${formatTime(reg.closedAt)}` : ""}`}
        breadcrumb={[{ label: "Cash register", href: "/cash" }]}
        actions={
          open ? (
            <StatusBadge tone="success">Open</StatusBadge>
          ) : reg.countedAt ? (
            <StatusBadge tone="info">Closed · counted</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Closed · not counted</StatusBadge>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Opening float"
          value={reg.openingFloatMinor === null ? "Not recorded" : formatMinor(reg.openingFloatMinor)}
          hint="Cash at the start"
        />
        <KpiCard label="Cash taken" value={formatMinor(reg.taken.CASH)} hint={`${reg.bills} bills on this shift`} tone="emerald" />
        <KpiCard label="Paid in / out" value={`${formatMinor(reg.paidIn)} / ${formatMinor(reg.paidOut)}`} hint="During the shift" tone="violet" />
        <KpiCard label="Expected cash" value={formatMinor(reg.expected.CASH)} hint="Float + cash taken + in − out" tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {reg.sellers.length > 0 && (
            <Card>
              <CardHeader title="Sold by" subtitle="Each person's bills on this counter's shift. One drawer is counted for all of them." />
              <ul className="divide-y divide-slate-100 px-5 pb-4">
                {reg.sellers.map((p) => (
                  <li key={p.userId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="font-medium text-slate-900">{p.name}</span>
                    <span className="text-slate-500">
                      {p.bills} {p.bills === 1 ? "bill" : "bills"}
                      <b className="ml-3 tabular-nums text-slate-900">{formatMinor(p.totalMinor)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="By payment method" subtitle="Confirmed payments on this shift's bills." />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="sr-only">Expected and counted by method</caption>
                <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2">
                      Method
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Expected
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Counted
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Difference
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(["CASH", "UPI", "CARD"] as const).map((m) => {
                    const c = reg.counts.find((x) => x.method === m);
                    return (
                      <tr key={m}>
                        <td className="py-2 font-medium text-slate-900">{METHOD[m]}</td>
                        <td className="py-2 text-right tabular-nums">{formatMinor(c?.expectedMinor ?? reg.expected[m])}</td>
                        <td className="py-2 text-right tabular-nums">{c ? formatMinor(c.countedMinor) : "—"}</td>
                        <td
                          className={`py-2 text-right font-semibold tabular-nums ${
                            !c ? "text-slate-500" : c.differenceMinor === 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {!c
                            ? "—"
                            : c.differenceMinor === 0
                              ? "0"
                              : `${c.differenceMinor > 0 ? "+" : "−"}${formatMinor(Math.abs(c.differenceMinor))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {reg.storeCashRefundsMinor > 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {formatMinor(reg.storeCashRefundsMinor)} was refunded in cash in this store during the shift. Refunds aren&apos;t
                  tied to a till, so it is not taken off the expected cash — if it came from this drawer, say so in the note.
                </p>
              )}
              {reg.closingNote && <p className="mt-3 text-sm text-slate-700">Note: {reg.closingNote}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Cash paid in and out" />
            {reg.cashMovements.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-slate-600">None on this shift.</p>
            ) : (
              <ul className="divide-y divide-slate-100 px-5 pb-3 text-sm">
                {reg.cashMovements.map((m) => (
                  <li key={m.id} className="amb-line-in flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-slate-900">{m.reason}</span>
                      <span className="text-xs text-slate-500">{formatTime(m.createdAt)}</span>
                    </span>
                    <span className={`font-semibold tabular-nums ${m.kind === "PAY_IN" ? "text-emerald-700" : "text-rose-700"}`}>
                      {m.kind === "PAY_IN" ? "+" : "−"}
                      {formatMinor(m.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          {open && canAct ? (
            <>
              {reg.openingFloatMinor === null && (
                <Card>
                  <CardHeader title="Opening float" />
                  <div className="px-5 pb-5">
                    <FloatForm sessionId={reg.id} />
                  </div>
                </Card>
              )}
              <Card>
                <CardHeader title="Pay in or out" />
                <div className="px-5 pb-5">
                  <MovementForm sessionId={reg.id} approvers={approvers} />
                </div>
              </Card>
              {reg.openingFloatMinor !== null && (
                <Card>
                  <CardHeader title="Close and count" subtitle="Count the drawer and check UPI and card totals." />
                  <div className="px-5 pb-5">
                    <CloseCountForm sessionId={reg.id} expected={reg.expected} />
                  </div>
                </Card>
              )}
            </>
          ) : !open && reg.varianceStatus === "PENDING_APPROVAL" ? (
            <Card>
              <CardHeader title="Difference needs approval" subtitle="The owner or a manager who didn't run or count this till approves it." />
              <div className="px-5 pb-5">
                {canApprove && ctx.userId !== reg.countedByUserId && ctx.userId !== reg.cashierUserId ? (
                  <ApproveVarianceForm sessionId={reg.id} />
                ) : (
                  <p className="text-sm text-slate-600">Waiting for another manager or the owner.</p>
                )}
              </div>
            </Card>
          ) : !open && reg.varianceStatus === "APPROVED" ? (
            <Card>
              <CardHeader title="Difference approved" />
              <div className="space-y-2 px-5 pb-5 text-sm text-slate-700">
                {reg.varianceApprovalNote && <p>&ldquo;{reg.varianceApprovalNote}&rdquo;</p>}
                <p className="text-xs text-slate-500">
                  {reg.variancePostingStatus === "POSTED"
                    ? "Posted to accounting."
                    : "Not posted to accounting yet: waiting for finance to map the cash over/short account."}
                </p>
              </div>
            </Card>
          ) : open ? (
            <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
              Only the cashier on this shift, a store manager or the owner can handle this drawer.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
