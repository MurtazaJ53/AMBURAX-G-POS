import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getSaleDetail, type SaleDetail } from "@/server/sales/saleQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../formatDateTime";

/**
 * The bill.
 *
 * Every line comes from the snapshot taken when the sale committed, not from a live join
 * against the catalogue. A price change tomorrow must not rewrite what a customer was
 * charged today — that is the whole reason `SaleItem` stores `nameSnapshot` and
 * `skuSnapshot`.
 *
 * The lookup is tenant-scoped, so another tenant's sale id produces the same "not found"
 * as an id that never existed.
 */
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await params;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("bill: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");

  let sale: SaleDetail | null;
  try {
    sale = await getSaleDetail({ tenantId: resolved.context.tenantId, saleId: id });
  } catch (err) {
    logError("bill: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!sale) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Bill not found</h1>
          <p className="mt-2 text-sm text-slate-600">
            This sale doesn&apos;t exist, or it belongs to a different business.
          </p>
          <Link
            href="/sales"
            className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Back to sales
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link href="/sales" className="text-sm text-slate-500 hover:underline">
        &larr; Sales
      </Link>

      <article className="mt-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="border-b border-dashed border-slate-200 pb-4 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{sale.storeName}</h1>
          <p className="text-xs text-slate-500">{sale.storeCode}</p>
          <p className="mt-3 text-sm font-medium text-slate-900">Bill {sale.billNumber}</p>
          <p className="text-xs text-slate-500">{formatDateTime(sale.completedAt)}</p>
          <p className="text-xs text-slate-500">Served by {sale.cashierName}</p>
          {sale.status === "VOIDED" && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              This sale was voided.
            </p>
          )}
        </header>

        {sale.customer && (
          <section className="border-b border-dashed border-slate-200 py-3 text-sm">
            <p className="font-medium text-slate-900">{sale.customer.name}</p>
            {sale.customer.phone && <p className="text-xs text-slate-500">{sale.customer.phone}</p>}
          </section>
        )}

        <section className="py-3">
          <table className="w-full text-sm">
            <caption className="sr-only">Items on this bill</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th scope="col" className="pb-2 font-medium">
                  Item
                </th>
                <th scope="col" className="pb-2 text-center font-medium">
                  Qty
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sale.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 pr-2">
                    <span className="block text-slate-900">{item.name}</span>
                    <span className="block text-xs text-slate-500">
                      {item.sku} · {formatMinor(item.unitPriceMinor)} each
                    </span>
                  </td>
                  <td className="py-2 text-center align-top text-slate-700">{item.quantity}</td>
                  <td className="py-2 text-right align-top font-medium text-slate-900">
                    {formatMinor(item.lineTotalMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <dl className="space-y-1 border-t border-dashed border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd>{formatMinor(sale.subtotalMinor)}</dd>
          </div>
          {sale.discountMinor > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>Discount</dt>
              <dd>&minus;{formatMinor(sale.discountMinor)}</dd>
            </div>
          )}
          {/* Prices are tax-inclusive (ADR-081): tax is a component of the total, not an
              addition to it, and the label has to say so or the arithmetic looks wrong. */}
          <div className="flex justify-between text-slate-600">
            <dt>Tax (included)</dt>
            <dd>{formatMinor(sale.taxMinor)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{formatMinor(sale.totalMinor)}</dd>
          </div>
        </dl>

        <section className="mt-4 border-t border-dashed border-slate-200 pt-3 text-sm">
          <h2 className="text-xs uppercase tracking-wide text-slate-400">Payment</h2>
          <ul className="mt-1 space-y-1">
            {sale.payments.map((payment, index) => (
              <li key={index} className="flex justify-between text-slate-700">
                <span>
                  {payment.method}
                  {payment.reference && (
                    <span className="text-xs text-slate-500"> · {payment.reference}</span>
                  )}
                  {/*
                    Payment status is shown rather than assumed. AMBURAX records what the
                    operator took on their own terminal; it does not verify it, so a
                    PENDING payment must not read as settled.
                  */}
                  {payment.status !== "CONFIRMED" && (
                    <span className="text-xs text-amber-700"> · {payment.status.toLowerCase()}</span>
                  )}
                </span>
                <span className="font-medium">{formatMinor(payment.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/*
          No ERPNext adapter exists yet (ADR-001: AMBURAX orchestrates ERPNext, it does not
          replace it). The bill says where the sale has and has not reached, rather than
          implying an invoice was posted to the ledger.
        */}
        <footer className="mt-4 border-t border-dashed border-slate-200 pt-3">
          {sale.erpSyncStatus === "SYNCED" && sale.erpInvoiceId ? (
            <p className="text-xs text-slate-500">Accounting invoice {sale.erpInvoiceId}</p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Recorded in AMBURAX. Not yet posted to accounting
              {sale.erpSyncStatus === "FAILED" && " — the last attempt failed"}.
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
