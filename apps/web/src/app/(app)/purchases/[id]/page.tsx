import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { getPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";
import { listPurchaseReturns } from "@/server/purchasing/purchaseReturns";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { ReturnToSupplierForm } from "../ReturnToSupplierForm";
import { DataTable, PageHeader, Td, Th } from "../../_components/ui";
import { formatDateOnly, formatDateTime } from "../../sales/formatDateTime";
import { PrintBarcodeButton } from "../../products/[id]/PrintBarcodeButton";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value);
  } catch (err) {
    logError("purchases/[id]: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");

  let receipt: Awaited<ReturnType<typeof getPurchaseReceipt>>;
  let returns: Awaited<ReturnType<typeof listPurchaseReturns>>;
  try {
    [receipt, returns] = await Promise.all([
      getPurchaseReceipt({ tenantId: resolved.context.tenantId, receiptId: id }),
      listPurchaseReturns({ tenantId: resolved.context.tenantId, receiptId: id }),
    ]);
  } catch (err) {
    logError("purchases/[id]: read failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!receipt) notFound();

  const printableVariants = receipt.lines.map((l) => {
    // Check if this variant has an active pending price change queued from this purchase
    const latestPending = l.variant.pendingPriceChanges?.[0];
    const effectivePriceMinor = latestPending?.newPriceMinor ?? l.variant.priceMinor ?? 0;
    const effectiveMrpMinor = latestPending ? latestPending.newMrpMinor : l.variant.mrpMinor;

    return {
      id: l.variant.id,
      sku: l.variant.sku,
      barcode: l.variant.barcode,
      productName: l.variant.product.name,
      size: l.variant.size,
      colour: l.variant.colour,
      priceMinor: effectivePriceMinor,
      mrpMinor: effectiveMrpMinor,
      quantity: l.quantity,
    };
  });

  const subtitle = [
    receipt.supplier.name,
    receipt.supplier.gstin ? `GSTIN ${receipt.supplier.gstin}` : null,
    `received ${formatDateTime(receipt.createdAt)}`,
    receipt.supplierInvoiceDate ? `invoice dated ${formatDateOnly(receipt.supplierInvoiceDate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title={`Invoice ${receipt.supplierInvoiceNo}`}
        subtitle={subtitle}
        breadcrumb={[{ label: "Purchases", href: "/purchases" }]}
        actions={
          <div className="flex items-center gap-2">
            <PrintBarcodeButton
              variants={printableVariants}
              storeName={resolved.context.storeName}
              buttonLabel="Print Barcode Stickers"
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition-colors"
            />
          </div>
        }
      />

      <p role="status" className="amb-fade-in mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Stock for these items was added to the store when this purchase was saved.
      </p>

      <DataTable caption="Items received">
        <thead>
          <tr>
            <Th>Item</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Cost / unit</Th>
            <Th align="right">GST</Th>
            <Th align="right">Taxable</Th>
            <Th align="right">Input GST</Th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={l.id}>
              <Td>
                <span className="font-medium text-slate-900">{l.variant.product.name}</span>
                <span className="block font-mono text-xs text-slate-500">
                  {[l.variant.sku, l.variant.size, l.variant.colour].filter(Boolean).join(" · ")}
                  {l.variant.barcode ? ` · Barcode: ${l.variant.barcode}` : ""}
                </span>
              </Td>
              <Td align="right" className="tabular-nums font-semibold text-slate-900">
                {l.quantity}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatMinor(l.unitCostMinor)}
              </Td>
              <Td align="right" className="tabular-nums">
                {l.gstRateBp / 100}%
              </Td>
              <Td align="right" className="tabular-nums">
                {formatMinor(l.taxableMinor)}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatMinor(l.inputTaxMinor)}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-6">
          <dt className="text-slate-600">Taxable value</dt>
          <dd className="tabular-nums text-slate-900">{formatMinor(receipt.taxableMinor)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-slate-600">Input GST</dt>
          <dd className="tabular-nums text-slate-900">{formatMinor(receipt.inputTaxMinor)}</dd>
        </div>
        <div className="flex justify-between gap-6 border-t border-slate-200 pt-1 font-semibold">
          <dt className="text-slate-900">Invoice total</dt>
          <dd className="tabular-nums text-slate-900">{formatMinor(receipt.totalMinor)}</dd>
        </div>
      </dl>
      {receipt.notes && <p className="mt-4 text-sm text-slate-600">Notes: {receipt.notes}</p>}

      {canManageInventory(resolved.context) && (
        <ReturnToSupplierForm
          receiptId={receipt.id}
          lines={receipt.lines.map((l) => {
            const returned = l.returnLines.reduce((sum, r) => sum + r.quantity, 0);
            return {
              id: l.id,
              name: l.variant.product.name,
              sku: l.variant.sku,
              received: l.quantity,
              returnable: Math.max(0, l.quantity - returned),
            };
          })}
        />
      )}

      {returns.length > 0 && (
        <section aria-labelledby="returns-h" className="mt-8">
          <h2 id="returns-h" className="mb-3 text-base font-semibold text-slate-900">
            Returned to supplier
          </h2>
          <ul className="space-y-3">
            {returns.map((r) => (
              <li key={r.id} className="amb-fade-in rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{r.reason}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</p>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {r.lines
                    .map((l) => `${l.quantity} × ${l.receiptLine.variant.product.name} (${l.receiptLine.variant.sku})`)
                    .join(", ")}
                </p>
                <p className="mt-1 text-xs tabular-nums text-slate-500">
                  {formatMinor(r.taxableMinor)} + input GST reversed {formatMinor(r.inputTaxMinor)} ={" "}
                  <span className="font-semibold text-slate-700">{formatMinor(r.totalMinor)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
