import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowRightLeft, Plus } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { hasInventoryRightsIn, listTransfers } from "@/server/inventory/stockTransfers";
import { buttonClass, DataTable, EmptyState, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateOnly } from "../../sales/formatDateTime";
import { STATUS_LABEL, STATUS_TONE } from "./transferLabels";

/** Stock transfers in and out of the current store (screen 28). */
export default async function TransfersPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("transfers: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let rows: Awaited<ReturnType<typeof listTransfers>>;
  let canSend: boolean;
  let storeCount: number;
  try {
    [rows, canSend, storeCount] = await Promise.all([
      listTransfers({ tenantId: ctx.tenantId, storeId: ctx.storeId }),
      hasInventoryRightsIn({ tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole }, ctx.storeId),
      db.store.count({ where: { tenantId: ctx.tenantId } }),
    ]);
  } catch (err) {
    logError("transfers: list failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Stock transfers"
        subtitle={`Stock moving in and out of ${ctx.storeName}.`}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }]}
        actions={
          canSend && storeCount > 1 ? (
            <Link href="/inventory/transfers/new" className={`${buttonClass("primary")} amb-press`}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              New transfer
            </Link>
          ) : undefined
        }
      />
      {storeCount < 2 && (
        <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Transfers need at least two stores. Add another store to move stock between them.
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<ArrowRightLeft className="h-5 w-5" />}
            title="No transfers yet"
            description="Transfers sent from or to this store will appear here."
          />
        </div>
      ) : (
        <DataTable caption="Transfers">
          <thead>
            <tr>
              <Th>Sent</Th>
              <Th>Direction</Th>
              <Th>Store</Th>
              <Th align="right">Units</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const outgoing = t.fromStoreId === ctx.storeId;
              const other = outgoing ? t.toStore : t.fromStore;
              const sent = t.lines.reduce((s, l) => s + l.quantity, 0);
              const got = t.lines.reduce((s, l) => s + (l.receivedQuantity ?? 0), 0);
              return (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/inventory/transfers/${t.id}`} className="amb-focus font-medium text-sky-700 hover:underline">
                      {formatDateOnly(t.createdAt)}
                    </Link>
                  </Td>
                  <Td>{outgoing ? "Out to" : "In from"}</Td>
                  <Td>
                    {other.name} <span className="text-slate-500">({other.code})</span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {t.status === "RECEIVED" && got !== sent ? `${got} of ${sent}` : sent}
                  </Td>
                  <Td>
                    <StatusBadge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusBadge>
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
