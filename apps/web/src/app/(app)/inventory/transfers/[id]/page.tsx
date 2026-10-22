import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getTransfer, hasInventoryRightsIn } from "@/server/inventory/stockTransfers";
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, Td, Th } from "../../../_components/ui";
import { formatDateTime } from "../../../sales/formatDateTime";
import { CancelTransferButton, ReceiveTransferForm } from "../TransferForms";
import { STATUS_LABEL, STATUS_TONE } from "../transferLabels";

/** One transfer: what was sent, what arrived, and the receive / cancel actions (screen 29). */
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("transfers/[id]: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  const actor = { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole };

  let transfer: Awaited<ReturnType<typeof getTransfer>>;
  let canReceive = false;
  let canCancel = false;
  try {
    transfer = await getTransfer({ tenantId: ctx.tenantId, transferId: id });
    if (transfer && transfer.status === "IN_TRANSIT") {
      [canReceive, canCancel] = await Promise.all([
        hasInventoryRightsIn(actor, transfer.toStoreId),
        hasInventoryRightsIn(actor, transfer.fromStoreId),
      ]);
    }
  } catch (err) {
    logError("transfers/[id]: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!transfer) notFound();
  const sent = transfer.lines.reduce((s, l) => s + l.quantity, 0);
  const subtitle = [
    `Sent ${formatDateTime(transfer.createdAt)}`,
    transfer.receivedAt ? `received ${formatDateTime(transfer.receivedAt)}` : null,
    transfer.cancelledAt ? `cancelled ${formatDateTime(transfer.cancelledAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Stock transfer"
        subtitle={subtitle}
        breadcrumb={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/inventory/transfers/${transfer.id}/challan`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              📄 Delivery Challan / Gate Pass
            </Link>
            <StatusBadge tone={STATUS_TONE[transfer.status]}>{STATUS_LABEL[transfer.status]}</StatusBadge>
          </div>
        }
      />

      <div className="amb-fade-in mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm">
        <span className="font-semibold text-slate-900">
          {transfer.fromStore.name} <span className="font-normal text-slate-500">({transfer.fromStore.code})</span>
        </span>
        <ArrowRight aria-label="to" className="h-4 w-4 text-slate-500" />
        <span className="font-semibold text-slate-900">
          {transfer.toStore.name} <span className="font-normal text-slate-500">({transfer.toStore.code})</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="tabular-nums text-slate-600 font-medium">{sent} units</span>
          {(() => {
            const totalValueMinor = transfer.lines.reduce((acc, l) => acc + (l.unitCostMinor ?? 0) * l.quantity, 0);
            if (totalValueMinor <= 0) return null;
            const needsManagerApproval = totalValueMinor >= 5_000_000; // >= ₹50,000 threshold
            return (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                needsManagerApproval ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-slate-100 text-slate-700"
              }`}>
                Valuation: ₹{(totalValueMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                {needsManagerApproval && <span className="text-[10px] text-amber-600 font-bold ml-1">(Manager Approval Tier)</span>}
              </span>
            );
          })()}
        </div>
        {transfer.note && <p className="w-full text-slate-600">Note: {transfer.note}</p>}
      </div>

      {transfer.status === "IN_TRANSIT" && canReceive ? (
        <Card className="mb-6">
          <CardHeader title="Receive this transfer" subtitle="Confirm what arrived. Stock is added to this store." />
          <div className="px-5 pb-5">
            <ReceiveTransferForm
              transferId={transfer.id}
              lines={transfer.lines.map((l) => ({
                id: l.id,
                name: l.variant.product.name,
                sku: l.variant.sku,
                quantity: l.quantity,
              }))}
            />
          </div>
        </Card>
      ) : (
        <DataTable caption="Items">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Sent</Th>
              <Th align="right">Received</Th>
            </tr>
          </thead>
          <tbody>
            {transfer.lines.map((l) => {
              const short = l.receivedQuantity !== null && l.receivedQuantity < l.quantity;
              return (
                <tr key={l.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{l.variant.product.name}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {[l.variant.sku, l.variant.size, l.variant.colour].filter(Boolean).join(" · ")}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {l.quantity}
                  </Td>
                  <Td align="right" className={`tabular-nums ${short ? "font-semibold text-rose-700" : ""}`}>
                    {l.receivedQuantity === null
                      ? "—"
                      : short
                        ? `${l.receivedQuantity} (${l.quantity - l.receivedQuantity} short)`
                        : l.receivedQuantity}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      {transfer.status === "IN_TRANSIT" && canCancel && (
        <div className="mt-6">
          <CancelTransferButton transferId={transfer.id} />
        </div>
      )}
      {transfer.status === "IN_TRANSIT" && !canReceive && (
        <p className="mt-4 text-sm text-slate-600">Waiting for {transfer.toStore.name} to receive it.</p>
      )}
    </div>
  );
}
