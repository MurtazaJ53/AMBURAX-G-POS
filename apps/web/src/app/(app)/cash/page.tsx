import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { CalendarCheck, Wallet } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { listOpenSessions } from "@/server/pos/cashRegister";
import { EmptyState, LinkButton, PageHeader, StatusBadge } from "../_components/ui";
import { formatTime } from "../sales/formatDateTime";

/** Cash register (screen 53): every till open in this store right now. */
export default async function CashPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("cash: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let sessions: Awaited<ReturnType<typeof listOpenSessions>>;
  try {
    sessions = await listOpenSessions({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("cash: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Cash register"
        subtitle={`Tills open in ${ctx.storeName}. Record the float, cash paid in or out, and close with a count.`}
        actions={
          <LinkButton href="/cash/day-close" variant="secondary">
            <CalendarCheck aria-hidden="true" className="h-4 w-4" />
            Day close
          </LinkButton>
        }
      />
      {sessions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="No till open" description="Open a shift from the till to start taking cash." />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Open tills">
          {sessions.map((s, i) => (
            <li key={s.id} className="cust-rise" style={{ ["--i" as string]: i }}>
              <Link
                href={`/cash/${s.id}`}
                className="amb-focus amb-lift block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-sky-200 hover:shadow-md"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {s.posDevice.name} <span className="font-mono text-xs text-slate-500">{s.posDevice.code}</span>
                  </span>
                  {s.openingFloatMinor === null ? (
                    <StatusBadge tone="warning">No float yet</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">Float {formatMinor(s.openingFloatMinor)}</StatusBadge>
                  )}
                </span>
                <span className="mt-1 block text-sm text-slate-600">
                  {s.cashier.name}
                  {s.cashierUserId === ctx.userId && " (you)"} · since {formatTime(s.openedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
