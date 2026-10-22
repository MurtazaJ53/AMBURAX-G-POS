import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";
import { ArrowLeft, Building2, Package, CheckCircle2, MapPin, Truck } from "lucide-react";
import { PrintTrigger } from "./PrintTrigger";

export const metadata = {
  title: "B2B Packing Slip & Wholesale Dispatch — AMBURAX POS",
};

export default async function B2bOrderDetailPage({
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
    logError("b2b:order:detail: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const order = await db.order.findFirst({
    where: {
      id,
      tenantId: ctx.tenantId,
    },
    include: {
      customer: true,
      items: {
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
      addresses: true,
    },
  });

  if (!order) notFound();

  const billingAddr = order.addresses.find((a) => a.type === "BILLING") || order.addresses[0];
  const totalUnits = order.items.reduce((acc, it) => acc + it.quantity, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Back button & top bar - hidden in print */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href="/b2b/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Wholesale Orders
        </Link>
        <PrintTrigger />
      </div>

      {/* Printable Wholesale Packing Slip Container */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-8 shadow-sm print:border-none print:p-0 print:shadow-none">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-slate-200 pb-6 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
              <Truck className="h-3.5 w-3.5" /> OFFICIAL B2B PACKING & DISPATCH SLIP
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 font-mono">
              {order.orderNumber}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Generated: {formatDateTime(order.createdAt)}
            </p>
          </div>
          <div className="sm:text-right">
            <h2 className="text-base font-bold text-slate-900">{ctx.storeName}</h2>
            <p className="text-xs text-slate-500">Wholesale & Trade Distribution Dept</p>
            <p className="text-xs font-mono text-slate-400 mt-1">Tenant: {ctx.tenantId.slice(0, 8)}</p>
          </div>
        </div>

        {/* Customer & Consignee Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-slate-100 text-xs">
          <div className="rounded-xl bg-slate-50/75 p-4 border border-slate-100">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Building2 className="h-3.5 w-3.5 text-slate-400" /> Billed Consignee
            </h3>
            <p className="mt-2 font-semibold text-slate-900 text-sm">
              {order.customer?.name || "Cash Trade Customer"}
            </p>
            {order.customer?.phone && (
              <p className="text-slate-600 mt-0.5 font-mono">Ph: {order.customer.phone}</p>
            )}
            {order.customer?.email && (
              <p className="text-slate-500 mt-0.5">{order.customer.email}</p>
            )}
          </div>

          <div className="rounded-xl bg-slate-50/75 p-4 border border-slate-100">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <MapPin className="h-3.5 w-3.5 text-slate-400" /> Delivery / Dispatch Hub
            </h3>
            {billingAddr ? (
              <div className="mt-2 text-slate-700 leading-relaxed">
                <p className="font-medium text-slate-900">{billingAddr.line1}</p>
                {billingAddr.line2 && <p>{billingAddr.line2}</p>}
                <p>
                  {billingAddr.city || "Bangalore"}, {billingAddr.state || "KA"} {billingAddr.postalCode}
                </p>
                <p className="font-mono text-slate-400 mt-1 text-[11px]">PIN: {billingAddr.postalCode}</p>
              </div>
            ) : (
              <p className="mt-2 text-slate-400 italic">No specific delivery address recorded.</p>
            )}
          </div>
        </div>

        {/* Line Items Table */}
        <div className="py-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center justify-between">
            <span>Dispatched Items & Lots</span>
            <span className="text-slate-700">{order.items.length} Lines · {totalUnits} Units</span>
          </h3>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Item / SKU Description</th>
                  <th className="py-2.5 px-3">HSN</th>
                  <th className="py-2.5 px-3 text-right">Units Packed</th>
                  <th className="py-2.5 px-3 text-right">Trade Rate</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3 text-center print:table-cell">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items.map((it, idx) => (
                  <tr key={it.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">
                        {it.variant?.product?.name || it.variant?.sku || "Wholesale Merchandise"}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        SKU: {it.variant?.sku || "N/A"}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500">
                      9983
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {it.quantity}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-600">
                      {formatMinor(it.unitPriceMinor)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {formatMinor(it.unitPriceMinor * it.quantity)}
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

        {/* Order Summary & Valuation */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-t border-slate-200 pt-6">
          <div className="max-w-xs text-[11px] text-slate-500 leading-relaxed">
            <p className="font-bold text-slate-700">Dispatch Terms & Acknowledgement:</p>
            <p className="mt-1">
              Goods received in sound condition and sealed cartons. Claims for breakage or shortage must be reported within 24 hours of delivery receipt.
            </p>
          </div>

          <div className="w-full sm:w-64 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono font-semibold">{formatMinor(order.subtotalMinor)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Estimated GST (18%):</span>
              <span className="font-mono font-semibold">{formatMinor(Math.round(order.subtotalMinor * 0.18))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-950">
              <span>Grand Total:</span>
              <span className="font-mono text-base">{formatMinor(Math.round(order.subtotalMinor * 1.18))}</span>
            </div>
          </div>
        </div>

        {/* Signatures & Seal */}
        <div className="mt-12 grid grid-cols-2 gap-8 border-t border-dashed border-slate-200 pt-8 text-center text-xs">
          <div>
            <div className="h-12 border-b border-slate-300"></div>
            <p className="mt-2 font-semibold text-slate-800">Dispatched & Verified By</p>
            <p className="text-[11px] text-slate-400">Warehouse Superintendant</p>
          </div>
          <div>
            <div className="h-12 border-b border-slate-300"></div>
            <p className="mt-2 font-semibold text-slate-800">Receiver / Transporter Sign</p>
            <p className="text-[11px] text-slate-400">Carrier / Consignee Agent</p>
          </div>
        </div>
      </div>
    </div>
  );
}
