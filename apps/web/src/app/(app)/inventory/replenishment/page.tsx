import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PackageCheck } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listRecentRequests, listReplenishment } from "@/server/inventory/replenishment";
import { DataTable, EmptyState, KpiCard, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateTime } from "../../sales/formatDateTime";
import { ReplenishForm } from "./ReplenishForm";

/** Low stock & replenishment (screen 32): what is running out here, and asking purchasing for more. */
export default async function ReplenishmentPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("replenishment: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let rows: Awaited<ReturnType<typeof listReplenishment>>;
  let requests: Awaited<ReturnType<typeof listRecentRequests>>;
  try {
    [rows, requests] = await Promise.all([
      listReplenishment({ tenantId: ctx.tenantId, storeId: ctx.storeId }),
      listRecentRequests({ tenantId: ctx.tenantId, storeId: ctx.storeId }),
    ]);
  } catch (err) {
    logError("replenishment: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const out = rows.filter((r) => r.quantity <= 0).length;
  const withLevel = rows.filter((r) => r.reorderLevel !== null).length;
  const formatCost = Object.fromEntries(
    rows.filter((r) => r.lastCostMinor !== null).map((r) => [r.variantId, formatMinor(r.lastCostMinor!)]),
  );
  const canEdit = canManageInventory({ tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole });

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Low stock & replenishment"
        subtitle={`Items in ${ctx.storeName} at or below their reorder level, most urgent first.`}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Need stock" value={String(rows.length)} hint="At or below reorder level" tone="amber" />
        <KpiCard label="Out of stock" value={String(out)} hint="None left on the shelf" tone="rose" />
        <KpiCard
          label="With a reorder level"
          value={String(withLevel)}
          hint={rows.length - withLevel > 0 ? `${rows.length - withLevel} use the 10-unit default` : "All set per item"}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<PackageCheck className="h-5 w-5" />}
            title="Nothing needs restocking"
            description="Every item here is above its reorder level."
          />
        </div>
      ) : (
        <ReplenishForm rows={rows} canEdit={canEdit} formatCost={formatCost} />
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold text-slate-900">Recent requests</h2>
      {requests.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">No requests yet.</p>
      ) : (
        <DataTable caption="Recent stock requests">
          <thead>
            <tr>
              <Th>Sent</Th>
              <Th align="right">Items</Th>
              <Th align="right">Units</Th>
              <Th>Backend</Th>
            </tr>
          </thead>
          <tbody>
            {requests.map((q) => (
              <tr key={q.id}>
                <Td>{formatDateTime(q.createdAt)}</Td>
                <Td align="right" className="tabular-nums">
                  {q.lines.length}
                </Td>
                <Td align="right" className="tabular-nums">
                  {q.lines.reduce((s, l) => s + l.quantity, 0)}
                </Td>
                <Td>
                  {q.erpSyncStatus === "SYNCED" ? (
                    <StatusBadge tone="success">{q.erpnextName ?? "Sent"}</StatusBadge>
                  ) : q.erpSyncStatus === "FAILED" ? (
                    <StatusBadge tone="danger">Not sent — retrying</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Waiting to send</StatusBadge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
