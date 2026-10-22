import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Plus, Truck } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listPurchaseReceipts } from "@/server/purchasing/purchaseReceipts";
import { buttonClass, DataTable, EmptyState, PageHeader, Td, Th } from "../_components/ui";
import { formatDateOnly } from "../sales/formatDateTime";

/**
 * Purchases — goods received from suppliers in this store.
 *
 * Cost excludes GST and input GST is shown separately (owner decision 2026-10-13). Paying the
 * supplier is not recorded here; that is ERPNext's.
 */
export default async function PurchasesPage() {
  // Read outside the try: cookies() is how Next learns this page is per-user, and catching around
  // it would hide that signal and let the build pre-render the error screen.
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("purchases: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let receipts: Awaited<ReturnType<typeof listPurchaseReceipts>>;
  try {
    receipts = await listPurchaseReceipts({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("purchases: list failed", err);
    return <ServiceUnavailableScreen />;
  }
  const canReceive = canManageInventory(ctx);

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Purchases"
        subtitle={`Goods received into ${ctx.storeName}. Cost excludes GST; input GST is shown separately.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/purchases/orders" className={buttonClass("secondary")}>
              Purchase orders
            </Link>
            {canReceive && (
              <Link href="/purchases/new" className={`${buttonClass("primary")} amb-press`}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                New purchase
              </Link>
            )}
          </div>
        }
      />

      {receipts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<Truck className="h-5 w-5" />}
            title="No purchases yet"
            description={
              canReceive
                ? "Record a supplier's invoice to add the goods to stock with their cost."
                : "A store manager or owner can record purchases."
            }
          />
        </div>
      ) : (
        <DataTable caption="Recent purchases">
          <thead>
            <tr>
              <Th>Received</Th>
              <Th>Supplier</Th>
              <Th>Invoice</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Taxable</Th>
              <Th align="right">Input GST</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <Td>{formatDateOnly(r.createdAt)}</Td>
                <Td>
                  <span className="font-medium text-slate-900">{r.supplier.name}</span>
                </Td>
                <Td>
                  <Link
                    href={`/purchases/${r.id}`}
                    className="amb-focus font-mono text-xs font-semibold text-sky-700 hover:underline"
                  >
                    {r.supplierInvoiceNo}
                  </Link>
                  {r.supplierInvoiceDate && (
                    <span className="block text-xs text-slate-500">dated {formatDateOnly(r.supplierInvoiceDate)}</span>
                  )}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r._count.lines}
                </Td>
                <Td align="right" className="tabular-nums">
                  {formatMinor(r.taxableMinor)}
                </Td>
                <Td align="right" className="tabular-nums">
                  {formatMinor(r.inputTaxMinor)}
                </Td>
                <Td align="right" className="tabular-nums font-semibold text-slate-900">
                  {formatMinor(r.totalMinor)}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
