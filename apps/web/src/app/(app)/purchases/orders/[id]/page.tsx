import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { getPurchaseOrder } from "@/server/purchasing/purchaseOrders";
import { lineInputTax } from "@/server/purchasing/purchaseReceipts";
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, Td, Th } from "../../../_components/ui";
import { formatDateOnly, formatDateTime } from "../../../sales/formatDateTime";
import { CancelOrderButton, ReceiveOrderForm } from "../OrderForms";
import { PROGRESS_LABEL, PROGRESS_TONE } from "../orderLabels";

/** Purchase order details (screen 48): lines, what has arrived, receiving the rest, cancelling. */
export default async function PurchaseOrderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("purchase orders: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let order: Awaited<ReturnType<typeof getPurchaseOrder>>;
  try {
    order = await getPurchaseOrder({ tenantId: ctx.tenantId, orderId: id });
  } catch (err) {
    logError("purchase order: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  // Tenant-scoped: another tenant's order is a 404.
  if (!order) notFound();

  const canAct = canManageInventory(ctx) && order.storeId === ctx.storeId && order.status === "OPEN";
  const due = order.lines
    .map((l) => ({
      id: l.id,
      name: l.variant.product.name,
      sku: l.variant.sku,
      due: l.quantity - l.receivedQuantity,
    }))
    .filter((l) => l.due > 0);
  const tax = order.lines.reduce((s, l) => s + lineInputTax(l.quantity * l.unitCostMinor, l.gstRateBp), 0);
  const nothingReceived = order.lines.every((l) => l.receivedQuantity === 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={`Order from ${order.supplier.name}`}
        subtitle={`For ${order.store.name} · placed ${formatDateOnly(order.createdAt)} · expected ${formatDateOnly(order.expectedDate)}`}
        breadcrumb={[
          { label: "Purchases", href: "/purchases" },
          { label: "Orders", href: "/purchases/orders" },
        ]}
        actions={<StatusBadge tone={PROGRESS_TONE[order.progress]}>{PROGRESS_LABEL[order.progress]}</StatusBadge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <DataTable caption="Order lines">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th align="right">Ordered</Th>
                <Th align="right">Received</Th>
                <Th align="right">Cost / unit</Th>
                <Th align="right">GST</Th>
                <Th align="right">Line</Th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
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
                  <Td align="right" className={`tabular-nums ${l.receivedQuantity >= l.quantity ? "text-emerald-700" : "text-slate-700"}`}>
                    {l.receivedQuantity}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(l.unitCostMinor)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {l.gstRateBp / 100}%
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(l.quantity * l.unitCostMinor)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-slate-600">Order value, excl. GST</dt>
              <dd className="tabular-nums text-slate-900">{formatMinor(order.taxableMinor)}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-slate-600">Expected GST</dt>
              <dd className="tabular-nums text-slate-900">{formatMinor(tax)}</dd>
            </div>
          </dl>

          {order.notes && <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{order.notes}</p>}

          <section aria-labelledby="deliveries">
            <h2 id="deliveries" className="mb-3 text-base font-semibold text-slate-900">
              Deliveries
            </h2>
            {order.receipts.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">Nothing has arrived yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {order.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <Link href={`/purchases/${r.id}`} className="amb-focus rounded font-medium text-sky-700 hover:underline">
                      Invoice {r.supplierInvoiceNo}
                    </Link>
                    <span className="text-slate-600">
                      {formatDateTime(r.createdAt)} · <span className="tabular-nums text-slate-900">{formatMinor(r.totalMinor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {canAct && due.length > 0 && (
            <Card>
              <CardHeader title="Receive goods" subtitle="Enter what arrived. Stock is added when you save." />
              <div className="px-5 pb-5">
                <ReceiveOrderForm orderId={order.id} lines={due} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Accounting" />
            <div className="px-5 pb-5 text-sm text-slate-700">
              {order.erpSyncStatus === "SYNCED" ? (
                <p>
                  Purchase Order <span className="font-mono">{order.erpnextName}</span>
                </p>
              ) : order.erpSyncStatus === "FAILED" ? (
                <p className="text-rose-700">Not sent yet — it will be retried.</p>
              ) : (
                <p className="text-slate-600">Waiting to send.</p>
              )}
            </div>
          </Card>
          {canAct && nothingReceived && <CancelOrderButton orderId={order.id} />}
        </aside>
      </div>
    </div>
  );
}
