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
import { PrintButton } from "./PrintButton";
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  StatusBadge,
  Td,
  Th,
} from "../../_components/ui";

/**
 * Bill details — the transaction workspace for one sale.
 *
 * Every line comes from the snapshot taken when the sale committed, not from a live join
 * against the catalogue. A price change tomorrow must not rewrite what a customer was
 * charged today: that is the whole reason `SaleItem` stores `nameSnapshot` and
 * `skuSnapshot`.
 *
 * The lookup is tenant-scoped, so another tenant's sale id produces the same "not found" as
 * an id that never existed.
 *
 * Absent by necessity: the design reference shows an MRP column, a POS terminal and shift,
 * an ERPNext invoice link and a customer purchase-history panel. `SaleItem` stores no MRP
 * snapshot, `Sale` carries no device or shift, and no ERPNext invoice exists — so none of
 * them are drawn rather than reconstructed from a guess.
 */

function MetaField(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{props.label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{props.value}</dd>
    </div>
  );
}

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
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Bill not found" breadcrumb={[{ label: "Sales", href: "/sales" }]} />
        <Card>
          <EmptyState
            title="This bill doesn't exist"
            description="It may have been removed, or it belongs to a different business."
            action={<LinkButton href="/sales">Back to sales</LinkButton>}
          />
        </Card>
      </div>
    );
  }

  const posted = sale.erpSyncStatus === "SYNCED" && sale.erpInvoiceId;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title={`Bill ${sale.billNumber}`}
        subtitle={formatDateTime(sale.completedAt)}
        breadcrumb={[
          { label: "Sales", href: "/sales" },
          { label: sale.billNumber, href: `/sales/${sale.id}` },
        ]}
        actions={
          <>
            <PrintButton />
            <LinkButton href="/sales" variant="secondary">
              Back to sales
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              {sale.status === "VOIDED" ? (
                <StatusBadge tone="danger">Voided</StatusBadge>
              ) : (
                <StatusBadge tone="success">Completed</StatusBadge>
              )}
              {posted ? (
                <StatusBadge tone="success">Posted to accounting</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Not posted to accounting</StatusBadge>
              )}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetaField label="Bill number" value={sale.billNumber} />
              <MetaField label="Store" value={`${sale.storeName} (#${sale.storeCode})`} />
              <MetaField label="Cashier" value={sale.cashierName} />
              <MetaField label="Customer" value={sale.customer?.name ?? "Walk-in"} />
            </dl>
          </Card>

          <Card>
            <CardHeader title={`Items (${sale.items.length})`} />
            <DataTable caption={`Items on bill ${sale.billNumber}`}>
              <thead className="border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <Th>Item</Th>
                  <Th>SKU</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Unit price</Th>
                  <Th align="right">Tax</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sale.items.map((item) => (
                  <tr key={item.id}>
                    <Td className="font-medium text-slate-900">{item.name}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{item.sku}</Td>
                    <Td align="right">{item.quantity}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {formatMinor(item.unitPriceMinor)}
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-slate-500">
                      {formatMinor(item.taxMinor)}
                    </Td>
                    <Td align="right" className="whitespace-nowrap font-medium text-slate-900">
                      {formatMinor(item.lineTotalMinor)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>

          <Card>
            <CardHeader
              title="Payment"
              subtitle="Recorded by the operator — AMBURAX does not process payments"
            />
            <DataTable caption="Payments against this bill">
              <thead className="border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th>Confirmed</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sale.payments.map((payment, index) => (
                  <tr key={index}>
                    <Td className="font-medium text-slate-900">{payment.method}</Td>
                    <Td className="text-slate-500">{payment.reference ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-slate-500">
                      {payment.confirmedAt ? formatDateTime(payment.confirmedAt) : "—"}
                    </Td>
                    <Td align="right" className="whitespace-nowrap font-medium text-slate-900">
                      {formatMinor(payment.amountMinor)}
                    </Td>
                    <Td>
                      {/* Shown rather than assumed: a PENDING payment must not read as
                          settled. */}
                      {payment.status === "CONFIRMED" ? (
                        <StatusBadge tone="success">Confirmed</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">{payment.status}</StatusBadge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Summary" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal</dt>
                <dd>{formatMinor(sale.subtotalMinor)}</dd>
              </div>
              {sale.discountMinor > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Discount</dt>
                  <dd>&minus;{formatMinor(sale.discountMinor)}</dd>
                </div>
              )}
              {/* Prices are tax-inclusive (ADR-081): tax is a component of the total, not an
                  addition to it, and the label must say so or the arithmetic looks wrong. */}
              <div className="flex justify-between text-slate-600">
                <dt>Tax (included)</dt>
                <dd>{formatMinor(sale.taxMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
                <dt>Total</dt>
                <dd>{formatMinor(sale.totalMinor)}</dd>
              </div>
              <div className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                <dt>Amount paid</dt>
                <dd>{formatMinor(sale.paidMinor)}</dd>
              </div>
            </dl>
          </Card>

          {sale.customer && (
            <Card>
              <CardHeader title="Customer" />
              <div className="px-5 py-4">
                <p className="text-sm font-medium text-slate-900">{sale.customer.name}</p>
                {sale.customer.phone && (
                  <p className="mt-0.5 text-sm text-slate-500">{sale.customer.phone}</p>
                )}
                <Link
                  href={`/customers?q=${encodeURIComponent(sale.customer.phone ?? sale.customer.name)}`}
                  className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline print:hidden"
                >
                  View in customers
                </Link>
              </div>
            </Card>
          )}

          {/*
            ADR-001: AMBURAX orchestrates ERPNext, it does not replace it. No adapter exists,
            so the bill says where the sale has and has not reached rather than implying an
            invoice was posted to the ledger.
          */}
          <Card>
            <CardHeader title="Accounting" />
            <div className="px-5 py-4">
              {posted ? (
                <p className="text-sm text-slate-700">
                  Accounting invoice <span className="font-medium">{sale.erpInvoiceId}</span>
                </p>
              ) : (
                <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <p className="font-medium">Recorded in AMBURAX</p>
                  <p className="mt-0.5 text-amber-700">
                    Not yet posted to accounting
                    {sale.erpSyncStatus === "FAILED" && " — the last attempt failed"}.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
