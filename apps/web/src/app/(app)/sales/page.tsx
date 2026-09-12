import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { listSales, type SaleListRow } from "@/server/sales/saleQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "./formatDateTime";

/**
 * Sale history for the current store.
 *
 * Rendered on the server and searched with a plain GET form, so the list works without
 * JavaScript, is linkable, and survives a refresh — a till that has just crashed is
 * exactly when someone needs to look up the last bill.
 *
 * Scoped to the caller's tenant and store by the resolved context, never by a query
 * parameter.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const { q } = await searchParams;
  const query = (q ?? "").slice(0, 100);

  // Only the data load is wrapped; redirect() is implemented by throwing, so catching
  // around it would swallow the navigation.
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("sales: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");

  const context = resolved.context;

  let sales: SaleListRow[];
  try {
    sales = await listSales({
      tenantId: context.tenantId,
      storeId: context.storeId,
      query,
      limit: 50,
    });
  } catch (err) {
    logError("sales: history load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Sales</h1>
        <p className="text-sm text-slate-500">
          {context.storeName} ({context.storeCode})
        </p>
      </header>

      <form method="get" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Bill number, customer name or phone"
          aria-label="Search sales"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Search
        </button>
        {query && (
          <Link
            href="/sales"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Clear
          </Link>
        )}
      </form>

      {sales.length === 0 ? (
        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-10 text-center">
          {/*
            The two empty states are genuinely different questions: "you have not sold
            anything yet" and "your search found nothing". Collapsing them would leave an
            operator wondering whether the sale they are looking for was lost.
          */}
          {query ? (
            <>
              <p className="text-sm font-medium text-slate-900">
                No sales match &ldquo;{query}&rdquo;
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Try a bill number, or the customer&apos;s name or phone.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-900">No sales yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Completed sales in this store will appear here.
              </p>
              <Link
                href="/pos"
                className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Open the till
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sales.map((sale) => (
            <li key={sale.id}>
              <Link
                href={`/sales/${sale.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {sale.billNumber}
                    {sale.status === "VOIDED" && (
                      <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                        Voided
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDateTime(sale.completedAt)} · {sale.cashierName}
                    {sale.customerName && ` · ${sale.customerName}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium text-slate-900">
                    {formatMinor(sale.totalMinor)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {sale.paymentMethod ?? "—"}
                    {/* No ERPNext adapter exists yet, so every sale is unposted. Showing
                        it per row is what stops the list implying the books are up to
                        date. */}
                    {sale.erpSyncStatus !== "SYNCED" && " · not posted"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
