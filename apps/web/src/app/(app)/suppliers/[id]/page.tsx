import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { formatPhone } from "@/lib/customerFields";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { Card, CardHeader, DataTable, KpiCard, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateOnly } from "../../sales/formatDateTime";

/**
 * Supplier details (screen 46): who they are, every purchase received from them and every return
 * sent back. Totals are what was recorded here; amounts owed and payments are ERPNext's.
 */
export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("supplier detail: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let data;
  try {
    const supplier = await db.supplier.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (supplier) {
      const [receipts, returns] = await Promise.all([
        db.purchaseReceipt.findMany({
          where: { tenantId: ctx.tenantId, supplierId: supplier.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            supplierInvoiceNo: true,
            createdAt: true,
            taxableMinor: true,
            inputTaxMinor: true,
            totalMinor: true,
            store: { select: { name: true } },
          },
        }),
        db.purchaseReturn.findMany({
          where: { tenantId: ctx.tenantId, receipt: { supplierId: supplier.id } },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, receiptId: true, reason: true, createdAt: true, totalMinor: true },
        }),
      ]);
      data = { supplier, receipts, returns };
    }
  } catch (err) {
    logError("supplier detail: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!data) notFound();
  const { supplier, receipts, returns } = data;

  const purchased = receipts.reduce((s, r) => s + r.totalMinor, 0);
  const inputGst = receipts.reduce((s, r) => s + r.inputTaxMinor, 0);
  const returned = returns.reduce((s, r) => s + r.totalMinor, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title={supplier.name}
        subtitle={[supplier.city, supplier.gstin ? `GSTIN ${supplier.gstin}` : null].filter(Boolean).join(" · ") || undefined}
        breadcrumb={[{ label: "Suppliers", href: "/suppliers" }]}
        actions={
          <StatusBadge tone={supplier.isActive ? "success" : "neutral"}>{supplier.isActive ? "Active" : "Inactive"}</StatusBadge>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Purchased" value={formatMinor(purchased)} hint={`${receipts.length} invoices, incl. GST`} />
        <KpiCard label="Input GST" value={formatMinor(inputGst)} hint="On those invoices" />
        <KpiCard label="Returned" value={formatMinor(returned)} hint={`${returns.length} returns, incl. GST`} />
      </div>

      <Card className="mb-6">
        <CardHeader title="Contact" />
        <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Contact person</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{supplier.contactName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Phone</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{supplier.phone ? formatPhone(supplier.phone) : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{supplier.email ?? "—"}</dd>
          </div>
          {supplier.notes && (
            <div className="sm:col-span-3">
              <dt className="text-slate-500">Notes</dt>
              <dd className="mt-0.5 text-slate-700">{supplier.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <h2 className="mb-3 text-base font-semibold text-slate-900">Purchases</h2>
      {receipts.length === 0 ? (
        <p className="mb-6 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
          No purchases from this supplier yet.
        </p>
      ) : (
        <div className="mb-6">
          <DataTable caption="Purchases from this supplier">
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Invoice</Th>
                <Th>Store</Th>
                <Th align="right">Taxable</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDateOnly(r.createdAt)}</Td>
                  <Td>
                    <Link
                      href={`/purchases/${r.id}`}
                      className="amb-focus font-mono text-xs font-semibold text-sky-700 hover:underline"
                    >
                      {r.supplierInvoiceNo}
                    </Link>
                  </Td>
                  <Td>{r.store.name}</Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(r.taxableMinor)}
                  </Td>
                  <Td align="right" className="tabular-nums font-semibold text-slate-900">
                    {formatMinor(r.totalMinor)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {returns.length > 0 && (
        <>
          <h2 className="mb-3 text-base font-semibold text-slate-900">Returns</h2>
          <DataTable caption="Returns to this supplier">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Reason</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/purchases/${r.receiptId}`} className="amb-focus text-sky-700 hover:underline">
                      {formatDateOnly(r.createdAt)}
                    </Link>
                  </Td>
                  <Td>{r.reason}</Td>
                  <Td align="right" className="tabular-nums">
                    {formatMinor(r.totalMinor)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
      <p className="mt-6 text-xs text-slate-500">Amounts owed to the supplier and payments made are kept in Backend.</p>
    </div>
  );
}
