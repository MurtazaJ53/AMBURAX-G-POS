import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canViewReports } from "@/server/reports/salesReport";
import { backgroundSyncStatus, getSystemHealth } from "@/server/ops/operations";
import { DataTable, EmptyState, PageHeader, PermissionDeniedState, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateTime } from "../../sales/formatDateTime";
import { RetryButton } from "./RetryButton";
import { RetryAllButton } from "./RetryAllButton";
import { SystemHealthHeader } from "./SystemHealthHeader";
import { backendWording } from "@/lib/backendWording";

/** Words for the event types, so the owner reads "Sale Completed" rather than "SaleCompleted". */
const readable = (t: string) => t.replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * Integrations & System Health (screens 68, 81): what AMBURAX has sent to ERPNext, what is
 * waiting, and what failed. A failed record can be queued again by the owner.
 */
export default async function SystemHealthPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("system health: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (!canViewReports(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="System health" breadcrumb={[{ label: "Settings", href: "/settings" }]} />
        <PermissionDeniedState title="System health is for owners and store managers" description="It shows what has synced to accounting." />
      </div>
    );
  }
  let data: Awaited<ReturnType<typeof getSystemHealth>>;
  try {
    data = await getSystemHealth({ tenantId: ctx.tenantId });
  } catch (err) {
    logError("system health: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const pending = data.types.reduce((s, t) => s + t.pending, 0);
  const failed = data.types.reduce((s, t) => s + t.failed, 0);
  const isOwner = ctx.tenantRole === "OWNER";

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <SystemHealthHeader
        initialWaiting={pending}
        initialFailed={failed}
        initialRunning={backgroundSyncStatus(ctx.tenantId)}
      />
      <p className="text-xs text-slate-500">
        Records are sent to accounting automatically in the background. Use Sync now if they are waiting and you want them sent at once.
      </p>
      {data.oldestPendingAt && (
        <p className="amb-fade-in rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Oldest record waiting since {formatDateTime(data.oldestPendingAt)}. It is sent automatically; retries back off on errors.
        </p>
      )}

      {data.types.length === 0 ? (
        <EmptyState title="Nothing sent yet" description="Sales, purchases and other records appear here once they are queued for accounting." />
      ) : (
        <DataTable caption="Accounting sync by record type">
          <thead>
            <tr>
              <Th>Record</Th>
              <Th align="right">Sent</Th>
              <Th align="right">Waiting</Th>
              <Th align="right">Failed</Th>
              <Th>Last sent</Th>
            </tr>
          </thead>
          <tbody>
            {data.types.map((t) => (
              <tr key={t.eventType} className="amb-line-in">
                <Td>{readable(t.eventType)}</Td>
                <Td align="right" className="tabular-nums">
                  {t.published}
                </Td>
                <Td align="right" className="tabular-nums">
                  {t.pending > 0 ? <StatusBadge tone="warning">{t.pending}</StatusBadge> : 0}
                </Td>
                <Td align="right" className="tabular-nums">
                  {t.failed > 0 ? <StatusBadge tone="danger">{t.failed}</StatusBadge> : 0}
                </Td>
                <Td>{t.lastPublishedAt ? formatDateTime(t.lastPublishedAt) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {data.failures.length > 0 && (
        <section aria-labelledby="failures" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="failures" className="text-base font-semibold text-slate-900">
              Failed records
            </h2>
            {isOwner && <RetryAllButton count={data.failures.length} />}
          </div>
          <DataTable caption="Records that could not reach accounting">
            <thead>
              <tr>
                <Th>Record</Th>
                <Th>Failed</Th>
                <Th>Reason</Th>
                <Th align="right">
                  <span className="sr-only">Retry</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.failures.map((f) => (
                <tr key={f.id}>
                  <Td>
                    {readable(f.eventType)}
                    <span className="block text-xs text-slate-500">after {f.attempts} tries</span>
                  </Td>
                  <Td>{f.deadLetteredAt ? formatDateTime(f.deadLetteredAt) : "—"}</Td>
                  <Td>
                    <span className="line-clamp-3 max-w-md break-words text-xs text-slate-700">{f.lastError ? backendWording(f.lastError) : "No reason recorded"}</span>
                  </Td>
                  <Td align="right">{isOwner ? <RetryButton id={f.id} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {!isOwner && <p className="text-xs text-slate-500">Only the owner can queue a failed record again.</p>}
        </section>
      )}
    </div>
  );
}
