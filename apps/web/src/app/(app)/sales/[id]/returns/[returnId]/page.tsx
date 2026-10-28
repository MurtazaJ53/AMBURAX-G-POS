import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, FileText, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { resolvePosContext } from "@/server/sales/posContext";
import { getReturnDetail } from "@/server/sales/returnQueries";
import { formatMinor } from "@/server/sales/saleTotals";

function methodLabel(method: string): string {
  return method === "UPI" ? "UPI" : method.charAt(0) + method.slice(1).toLowerCase();
}

// Simple card component mirroring the sale detail page
function Card({ title, children, index = 0, className = "" }: { title: string; children: React.ReactNode; index?: number; className?: string }) {
  return (
    <div
      className={`amb-animate-in amb-slide-in-up amb-fade-in rounded-lg border border-border bg-background-card shadow-sm ${className}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="border-b border-border bg-background-subtle px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-tertiary">
        {title}
      </div>
      {children}
    </div>
  );
}

// Reusable label/value row
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-[11px] border-b border-border/50 last:border-0">
      <dt className="text-tertiary">{label}</dt>
      <dd className="font-medium text-primary text-right">{children}</dd>
    </div>
  );
}

// Reusable status pill
function Pill({ children, tone }: { children: React.ReactNode; tone: "success" | "warning" | "danger" | "neutral" }) {
  const tones = {
    success: "bg-emerald-100 text-emerald-800 border-emerald-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    danger: "bg-rose-100 text-rose-800 border-rose-200",
    neutral: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${tones[tone]}`}>
      {children}
    </span>
  );
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

import { cookies } from "next/headers";
import { env } from "@/lib/env";

export default async function ReturnDetailPage({ params: paramsPromise }: { params: Promise<{ id: string; returnId: string }> }) {
  // Next 16: route params arrive as a Promise; reading them synchronously is an error.
  const params = await paramsPromise;
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  const ctx = await resolvePosContext(token);
  
  if (ctx.status !== "ok") {
    redirect("/auth/login");
  }

  const returnDetail = await getReturnDetail({
    tenantId: ctx.context.tenantId,
    saleId: params.id,
    returnId: params.returnId,
  });

  if (!returnDetail) {
    notFound();
  }

  // Determine ERP sync status tone and text
  let erpTone: "success" | "warning" | "danger" | "neutral" = "neutral";
  let erpText = returnDetail.erpSyncStatus;

  if (returnDetail.erpSyncStatus === "SYNCED") {
    erpTone = "success";
    erpText = "Synced";
  } else if (returnDetail.erpSyncStatus === "FAILED") {
    erpTone = "danger";
    erpText = "Sync Failed";
  } else if (returnDetail.erpSyncStatus === "PENDING") {
    erpTone = "warning";
    erpText = "Pending Sync";
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/sales/${returnDetail.originalSaleId}`}
              className="group flex items-center gap-1.5 text-[11px] font-medium text-tertiary hover:text-primary transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              Back to Sale
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-primary sm:text-3xl">
            Return Details
          </h1>
          <p className="text-sm text-tertiary">
            ID: <span className="font-mono text-xs">{returnDetail.id}</span>
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Pill tone={returnDetail.status === "COMPLETED" ? "success" : "neutral"}>
            {returnDetail.status}
          </Pill>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Main Content */}
        <div className="space-y-6">
          <Card title="Returned Items" index={1}>
            <div className="relative overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-background-subtle/50 text-[11px] font-medium text-tertiary uppercase tracking-wider">
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">SKU</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Refunded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {returnDetail.items.map((item) => (
                    <tr key={item.id} className="text-primary text-xs">
                      <td className="px-4 py-3 font-medium">{item.name}</td>
                      <td className="px-4 py-3 text-tertiary font-mono">{item.sku}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMinor(item.refundMinor)}</td>
                    </tr>
                  ))}
                  {returnDetail.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-tertiary">
                        No items returned in this transaction.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t border-border bg-background-subtle/50">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-tertiary">
                      Total Refunded
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary tabular-nums">
                      {formatMinor(returnDetail.totalRefundMinor)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card title="Refund Payments" index={2}>
            {returnDetail.payments.length > 0 ? (
              <div className="relative overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background-subtle/50 text-[11px] font-medium text-tertiary uppercase tracking-wider">
                      <th className="px-4 py-2">Method</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Reference</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {returnDetail.payments.map((payment, i) => (
                      <tr key={i} className="text-primary text-xs">
                        <td className="px-4 py-3 font-medium">{methodLabel(payment.method)}</td>
                        <td className="px-4 py-3">
                          <Pill tone={payment.status === "COMPLETED" ? "success" : payment.status === "FAILED" ? "danger" : "warning"}>
                            {payment.status}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 text-tertiary">
                          {payment.reference || "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatMinor(payment.amountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-tertiary text-xs">
                No payment refunds recorded for this return.
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card title="Summary" index={3}>
            <dl className="pb-2">
              <Row label="Original Sale">
                <Link href={`/sales/${returnDetail.originalSaleId}`} className="text-primary-active hover:underline">
                  {returnDetail.originalBillNumber}
                </Link>
              </Row>
              <Row label="Store">
                {returnDetail.storeName}
              </Row>
              <Row label="Returned On">
                {formatDateTime(returnDetail.createdAt)}
              </Row>
              <Row label="Reason">
                {returnDetail.reason || "—"}
              </Row>
            </dl>
          </Card>

          <Card title="Accounting Status" index={4}>
            <dl className="pb-2">
              <Row label="Sync Status">
                <Pill tone={erpTone}>{erpText}</Pill>
              </Row>
              <Row label="Return Invoice">
                {returnDetail.erpInvoiceId ? (
                  <span className="font-mono">{returnDetail.erpInvoiceId}</span>
                ) : (
                  "—"
                )}
              </Row>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
