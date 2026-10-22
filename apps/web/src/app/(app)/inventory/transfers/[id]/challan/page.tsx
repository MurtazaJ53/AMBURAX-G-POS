import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getTransfer } from "@/server/inventory/stockTransfers";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";
import { ArrowLeft, Printer, Truck, Store, ArrowRight, ShieldCheck, CheckCircle2 } from "lucide-react";
import { PrintTrigger } from "@/app/(app)/b2b/orders/[id]/PrintTrigger";

export const metadata = {
  title: "Transfer Gate Pass & Delivery Challan — AMBURAX POS",
};

export default async function TransferChallanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("transfers:challan: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const transfer = await getTransfer({
    tenantId: ctx.tenantId,
    transferId: id,
  });

  if (!transfer) notFound();

  const totalQuantity = transfer.lines.reduce((acc, l) => acc + l.quantity, 0);
  const totalReceived = transfer.lines.reduce((acc, l) => acc + (l.receivedQuantity ?? 0), 0);
  const consignmentValueMinor = transfer.lines.reduce(
    (acc, l) => acc + (l.unitCostMinor ? l.unitCostMinor * l.quantity : 0),
    0
  );
  const requiresEWayBill = consignmentValueMinor >= 50_000_00; // >= ₹50,000 threshold under GST Rule 138
  const challanNo = `DC-${transfer.fromStore.code}-${transfer.id.slice(-6).toUpperCase()}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Action Bar */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/inventory/transfers/${transfer.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Transfer #{transfer.id.slice(-6)}
        </Link>
        <PrintTrigger />
      </div>

      {/* Printable Material Delivery Challan / Gate Pass */}
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-none print:p-0 print:shadow-none text-slate-900">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-slate-200 pb-6 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-800">
              <Truck className="h-3.5 w-3.5" /> STOCK TRANSFER DELIVERY CHALLAN & GATE PASS
            </div>
            <h1 className="mt-2 text-2xl font-black font-mono tracking-tight text-slate-950">
              {challanNo}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispatched: {formatDateTime(transfer.createdAt)}
            </p>
          </div>
          <div className="sm:text-right">
            <h2 className="text-base font-bold text-slate-900">{ctx.storeName}</h2>
            <p className="text-xs text-slate-500">Internal Inventory Logistics</p>
            <p className="text-xs font-mono text-slate-400 mt-1">Tenant: {ctx.tenantId.slice(0, 8)}</p>
          </div>
        </div>

        {/* Transfer Route */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-slate-100 text-xs">
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5 text-slate-400" /> Origin Facility (Dispatch)
            </span>
            <p className="mt-2 text-sm font-bold text-slate-900">{transfer.fromStore.name}</p>
            <p className="text-slate-600 font-mono text-[11px]">Store Code: {transfer.fromStore.code}</p>
            <p className="text-slate-500 mt-1">Status: Dispatched & Locked</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5 text-slate-400" /> Destination Facility (Receiving)
            </span>
            <p className="mt-2 text-sm font-bold text-slate-900">{transfer.toStore.name}</p>
            <p className="text-slate-600 font-mono text-[11px]">Store Code: {transfer.toStore.code}</p>
            <p className="text-slate-500 mt-1">
              Current State:{" "}
              <span className="font-semibold text-slate-800 uppercase">{transfer.status.replace("_", " ")}</span>
            </p>
          </div>
        </div>

        {requiresEWayBill ? (
          <div className="my-4 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3.5 text-xs text-indigo-950">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-600 px-2 py-0.5 font-bold text-white uppercase text-[10px]">
                  E-Way Bill Required
                </span>
                <span className="font-semibold">
                  Consignment Value: ₹{(consignmentValueMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <span className="font-mono text-[11px] font-semibold text-indigo-700">GST Rule 138 (&gt; ₹50,000)</span>
            </div>
            <p className="mt-1 text-[11px] text-indigo-800">
              Mandatory requirement for inter-store transit. Ensure 12-digit E-Way Bill is generated on NIC portal and accompanied with this Gate Pass.
            </p>
          </div>
        ) : consignmentValueMinor > 0 ? (
          <div className="my-3 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <span>Estimated Consignment Value:</span>
            <span className="font-mono font-bold text-slate-900">
              ₹{(consignmentValueMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
        ) : null}

        {transfer.note && (
          <div className="py-3 px-4 my-4 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900">
            <span className="font-bold">Dispatch Note:</span> {transfer.note}
          </div>
        )}

        {/* Manifest Items Table */}
        <div className="py-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center justify-between">
            <span>Material Manifest Lines</span>
            <span className="text-slate-700">{transfer.lines.length} Line Items · {totalQuantity} Dispatched Units</span>
          </h3>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Product Name & Specifications</th>
                  <th className="py-2.5 px-3">SKU</th>
                  <th className="py-2.5 px-3 text-right">Dispatched Qty</th>
                  <th className="py-2.5 px-3 text-right">Received Qty</th>
                  <th className="py-2.5 px-3 text-center">Transit Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfer.lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{line.variant.product.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {[line.variant.size, line.variant.colour].filter(Boolean).join(" · ") || "Standard"}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600 font-medium">
                      {line.variant.sku}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {line.quantity}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-medium text-slate-700">
                      {line.receivedQuantity !== null ? line.receivedQuantity : "—"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="mx-auto h-4 w-4 rounded border-2 border-slate-300"></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Security & Gate Pass Clauses */}
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-[11px] text-slate-500 leading-relaxed">
          <p className="font-bold text-slate-700">Statutory GST & Transport Clause (Rule 55 CGST Rules):</p>
          <p className="mt-0.5">
            This delivery challan is issued for inter-branch transfer of goods not by way of sale. No commercial tax liability arises at this transfer leg. Goods are accompanied for legitimate movement between business facilities.
          </p>
        </div>

        {/* Gate Pass & Dispatch Authorizations */}
        <div className="mt-10 grid grid-cols-3 gap-6 border-t border-slate-200 pt-8 text-center text-xs">
          <div>
            <div className="h-10 border-b border-slate-300"></div>
            <p className="mt-2 font-semibold text-slate-800">Dispatch Executive</p>
            <p className="text-[11px] text-slate-400">Warehouse Outward Section</p>
          </div>
          <div>
            <div className="h-10 border-b border-slate-300"></div>
            <p className="mt-2 font-semibold text-slate-800">Security Gate Officer</p>
            <p className="text-[11px] text-slate-400">Time Out & Vehicle Stamp</p>
          </div>
          <div>
            <div className="h-10 border-b border-slate-300"></div>
            <p className="mt-2 font-semibold text-slate-800">Receiving Store Manager</p>
            <p className="text-[11px] text-slate-400">Goods Inward Acknowledgement</p>
          </div>
        </div>
      </div>
    </div>
  );
}
