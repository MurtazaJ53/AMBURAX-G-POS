import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { PageHeader, StatusBadge } from "../../_components/ui";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../../sales/formatDateTime";
import { FileText, ArrowLeft, Building2, Package, CheckCircle2, Clock } from "lucide-react";

export const metadata = {
  title: "B2B Wholesale Orders — AMBURAX POS",
};

export default async function B2bOrdersPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("b2b:orders: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  // Fetch B2B orders (orderNumber containing -B2B-)
  const orders = await db.order.findMany({
    where: {
      tenantId: ctx.tenantId,
      orderNumber: { contains: "-B2B-" },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      items: true,
      addresses: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-2">
        <Link
          href="/b2b"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Pipeline
        </Link>
      </div>

      <PageHeader
        title="B2B Wholesale Orders"
        subtitle="Wholesale trade orders generated from leads and institutional corporate clients."
      />

      {orders.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-16 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
            <Building2 className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-slate-900">No B2B Wholesale Orders Yet</h3>
          <p className="mt-1 text-xs text-slate-500">
            Convert a qualified or won lead from the B2B pipeline into a wholesale order.
          </p>
          <div className="mt-6">
            <Link
              href="/b2b"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Go to B2B Pipeline
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Order No.</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Trade Customer</th>
                  <th className="py-3 px-4">Items / Lots</th>
                  <th className="py-3 px-4 text-right">Order Value</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {orders.map((o) => {
                  const totalUnits = o.items.reduce((sum, it) => sum + it.quantity, 0);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {o.orderNumber}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {formatDateTime(o.createdAt)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{o.customer?.name}</div>
                        {o.customer?.phone && (
                          <div className="text-[11px] text-slate-400">{o.customer.phone}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          <Package className="h-3 w-3 text-slate-400" />
                          {o.items.length} sku(s) · {totalUnits} pcs
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatMinor(o.subtotalMinor)}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge tone={o.status === "CONFIRMED" ? "success" : "neutral"}>
                          {o.status}
                        </StatusBadge>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/b2b/orders/${o.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5 text-slate-400" />
                          Packing Slip
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
