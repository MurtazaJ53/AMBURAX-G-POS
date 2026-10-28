import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { ClipboardList, Plus } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listPurchaseOrders } from "@/server/purchasing/purchaseOrders";
import { DataTable, EmptyState, LinkButton, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateOnly } from "../../sales/formatDateTime";
import { PROGRESS_LABEL, PROGRESS_TONE } from "./orderLabels";

/** Purchase orders (screen 47): what this store has ordered and how much has arrived. */
export default async function PurchaseOrdersPage() {
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

  let orders: Awaited<ReturnType<typeof listPurchaseOrders>>;
  try {
    orders = await listPurchaseOrders({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("purchase orders: list failed", err);
    return <ServiceUnavailableScreen />;
  }
  const canOrder = canManageInventory(ctx);

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Purchase orders"
        subtitle={`Orders placed for ${ctx.storeName}. Each one is a Purchase Order in accounting.`}
        breadcrumb={[{ label: "Purchases", href: "/purchases" }]}
        actions={
          canOrder ? (
            <LinkButton href="/purchases/orders/new">
              <Plus aria-hidden="true" className="h-4 w-4" />
              New order
            </LinkButton>
          ) : undefined
        }
      />
      {orders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="No orders yet"
            description="Place an order with a supplier, then receive the goods against it when they arrive."
          />
        </div>
      ) : (
        <DataTable caption="Purchase orders">
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th>Placed</Th>
              <Th>Expected</Th>
              <Th align="right">Received</Th>
              <Th align="right">Value</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const ordered = o.lines.reduce((s, l) => s + l.quantity, 0);
              const received = o.lines.reduce((s, l) => s + l.receivedQuantity, 0);
              return (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/purchases/orders/${o.id}`} className="amb-focus rounded font-medium text-sky-700 hover:underline">
                      {o.supplier.name}
                    </Link>
                    {o.erpnextName && <span className="block font-mono text-xs text-slate-500">{o.erpnextName}</span>}
                  </Td>
                  <Td>{formatDateOnly(o.createdAt)}</Td>
                  <Td>{formatDateOnly(o.expectedDate)}</Td>
                  <Td align="right" className="tabular-nums">
                    {received} / {ordered}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(o.taxableMinor)}
                  </Td>
                  <Td>
                    <StatusBadge tone={PROGRESS_TONE[o.progress]}>{PROGRESS_LABEL[o.progress]}</StatusBadge>
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
