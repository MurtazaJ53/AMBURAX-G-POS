import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ChevronLeft, ChevronRight, ReceiptText, ShoppingBag } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getCustomerDetail } from "@/server/sales/customers";
import { getCustomerHistory } from "@/server/sales/customerHistory";
import { formatMinor } from "@/server/sales/saleTotals";
import { EmptyState, KpiCard, PageHeader, StatusBadge } from "../../../_components/ui";
import { formatDateTime } from "../../../sales/formatDateTime";

/** Customer purchase history (screen 39): every bill, its lines and refunds, and what they buy most. */
export default async function CustomerHistoryPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await props.params;
  const page = Number((await props.searchParams).page) || 1;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("customer history: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");
  const ctx = resolved.context;

  let customer: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>> | null;
  let history: Awaited<ReturnType<typeof getCustomerHistory>> | null = null;
  try {
    customer = await getCustomerDetail({ tenantId: ctx.tenantId, id });
    if (customer) history = await getCustomerHistory({ tenantId: ctx.tenantId, customerId: customer.id, page });
  } catch (err) {
    logError("customer history: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  // Tenant-scoped: another tenant's id is a 404, not a leak.
  if (!customer || !history) notFound();

  const pageHref = (p: number) => `/customers/${customer.id}/history?page=${p}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Purchase history"
        subtitle={`Every completed bill for ${customer.name}, newest first.`}
        breadcrumb={[
          { label: "Customers", href: "/customers" },
          { label: customer.name, href: `/customers/${customer.id}` },
        ]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Bills" value={history.total.toLocaleString("en-IN")} hint="Completed" />
        <KpiCard label="Lifetime spend" value={formatMinor(customer.totalSpentMinor)} hint="Before refunds" tone="emerald" />
        <KpiCard
          label="Refunded"
          value={history.refundedMinor > 0 ? formatMinor(history.refundedMinor) : "—"}
          hint={history.refundCount > 0 ? `${history.refundCount} returns` : "No returns"}
          tone="rose"
        />
      </div>

      {history.total === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<ShoppingBag className="h-5 w-5" />} title="No purchases yet" description="Completed bills will appear here." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <ol className="space-y-3" aria-label="Bills">
            {history.sales.map((s, i) => (
              <li
                key={s.id}
                className="cust-rise rounded-xl border border-slate-200 bg-white shadow-sm"
                style={{ ["--i" as string]: Math.min(i, 8) }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/sales/${s.id}`}
                      className="amb-focus inline-flex min-h-11 items-center gap-1.5 rounded font-mono text-sm font-semibold text-sky-700 hover:underline"
                    >
                      <ReceiptText aria-hidden="true" className="h-4 w-4" />
                      {s.billNumber}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(s.completedAt)} · {s.store.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-slate-900">{formatMinor(s.totalMinor)}</p>
                    {s.refundedMinor > 0 && <StatusBadge tone="warning">{formatMinor(s.refundedMinor)} refunded</StatusBadge>}
                  </div>
                </div>
                <ul className="divide-y divide-slate-50 px-4 py-1 text-sm">
                  {s.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-slate-800">
                        {it.nameSnapshot}
                        <span className="ml-2 font-mono text-xs text-slate-500">{it.skuSnapshot}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-600">
                        {it.quantity} × <span className="text-slate-900">{formatMinor(it.lineTotalMinor)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <aside className="space-y-3" aria-labelledby="top-items">
            <h2 id="top-items" className="text-sm font-semibold text-slate-900">
              Buys most
            </h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {history.topItems.map((t) => (
                <li key={t.variantId} className="px-4 py-2.5 text-sm">
                  <span className="block truncate font-medium text-slate-900">{t.name}</span>
                  <span className="text-xs text-slate-500">
                    {t.units} units · {t.bills} {t.bills === 1 ? "bill" : "bills"} · {formatMinor(t.spentMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {history.pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {history.page > 1 ? (
            <Link
              href={pageHref(history.page - 1)}
              className="amb-focus inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-sky-700 hover:bg-sky-50"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-600">
            Page {history.page} of {history.pages}
          </span>
          {history.page < history.pages ? (
            <Link
              href={pageHref(history.page + 1)}
              className="amb-focus inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-sky-700 hover:bg-sky-50"
            >
              Older <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
