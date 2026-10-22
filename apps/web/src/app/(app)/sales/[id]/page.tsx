import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  History,
  Mail,
  MessageCircle,
  Package,
  PlusCircle,
  RefreshCcw,
  Repeat,
  Share2,
  ShoppingBag,
  UserRound,
  XCircle,
} from "lucide-react";

import { CopyButton } from "./CopyButton";
import { PrintButton } from "./PrintButton";
import { WhatsAppReceiptButton } from "./WhatsAppReceiptButton";
import { DownloadPdfButton } from "./DownloadPdfButton";
import { ShareReceiptButton } from "./ShareReceiptButton";
import { CancelBillModal } from "./CancelBillModal";
import { GstSummaryButton } from "./GstSummaryButton";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../formatDateTime";
import { gstTypeLabel } from "@/server/catalog/gstTaxTreatment";
import { listApprovers } from "@/server/identity/approvalPin";

/**
 * One bill, laid out as the Phase-2 reference: a header with the bill's actions, a summary
 * strip, the items table, payments beside the money summary, and actions / related / activity
 * along the bottom — with the customer, the store session and the posting state on the right.
 *
 * Only what the sale records is shown. Items carry no MRP snapshot and the schema has no sales
 * person or customer group, so those reference fields are left out rather than filled with
 * guesses. Actions with nothing behind them (PDF, share, e-mail, WhatsApp, returns, cancel) are
 * drawn disabled and labelled; printing is real.
 */

type Tone = "success" | "danger" | "warning" | "neutral" | "info";

const TONE: Record<Tone, string> = {
  success: "border-success-subtle bg-success-subtle text-success",
  danger: "border-danger-subtle bg-danger-subtle text-danger",
  warning: "border-warning-subtle bg-warning-subtle text-warning",
  neutral: "border-border bg-background-hover text-secondary",
  info: "border-info-subtle bg-info-subtle text-info",
};

function Pill({ tone, children, dot = false }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function Card(props: { title: string; action?: React.ReactNode; children: React.ReactNode; index: number; className?: string }) {
  const id = `bill-${props.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={`cust-rise min-w-0 overflow-hidden rounded-xl border border-border bg-background-card shadow-sm print:break-inside-avoid print:shadow-none ${props.className ?? ""}`}
      style={{ ["--i" as string]: props.index }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h2 id={id} className="text-[16px] font-bold text-primary">
          {props.title}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 px-4 py-1.5 text-[11px]">
      <dt className="text-tertiary">{props.label}</dt>
      <dd className="min-w-0 truncate text-primary">{props.children}</dd>
    </div>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const ACTION =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium";

function PendingAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button type="button" disabled title={`${label} is not available yet`} className={`${ACTION} cursor-not-allowed justify-center text-tertiary`}>
      <span aria-hidden="true">{icon}</span>
      {label}
      <span className="sr-only"> (not available yet)</span>
    </button>
  );
}

/**
 * The one action on this page that is real but conditional.
 *
 * Returns exist; exchanges do not, so this is labelled "Return" rather than claiming both. When
 * the bill cannot be returned, or the viewer may not authorise one, it stays a genuinely
 * disabled button that says which of the two it is — rather than a link that leads to a refusal.
 */
function ReturnAction({
  saleId,
  completed,
  authorised,
  tile = false,
}: {
  saleId: string;
  completed: boolean;
  authorised: boolean;
  tile?: boolean;
}) {
  const shape = tile ? `${ACTION} justify-center` : ACTION;

  if (!completed) {
    return (
      <button type="button" disabled title="Only a completed bill can be returned" className={`${shape} cursor-not-allowed text-tertiary`}>
        <RefreshCcw aria-hidden="true" className="h-4 w-4" />
        Return
        <span className="sr-only"> (only a completed bill can be returned)</span>
      </button>
    );
  }

  if (!authorised) {
    return (
      <button type="button" disabled title="Only a store manager or the owner can authorise a return" className={`${shape} cursor-not-allowed text-tertiary`}>
        <RefreshCcw aria-hidden="true" className="h-4 w-4" />
        Return
        <span className="sr-only"> (only a store manager or the owner can authorise a return)</span>
      </button>
    );
  }

  return (
    <Link href={`/sales/${saleId}/return`} className={`amb-press amb-focus ${shape} text-secondary transition-colors hover:text-primary`}>
      <RefreshCcw aria-hidden="true" className="h-4 w-4" />
      Return
    </Link>
  );
}

function ExchangeAction({
  saleId,
  completed,
  authorised,
}: {
  saleId: string;
  completed: boolean;
  authorised: boolean;
}) {
  if (!completed || !authorised) return null;

  return (
    <Link
      href={`/sales/${saleId}/exchange`}
      className={`amb-press amb-focus ${ACTION} text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-900 border-indigo-200`}
    >
      <Repeat aria-hidden="true" className="h-4 w-4 text-indigo-600" />
      Exchange
    </Link>
  );
}

function methodLabel(method: string): string {
  return method === "UPI" ? "UPI" : method.charAt(0) + method.slice(1).toLowerCase();
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const resolvedParams = await params;
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  // `/auth/login` is the real sign-in route; `/login` does not exist.
  if (!token) return redirect("/auth/login");

  const ctx = await resolvePosContext(token);
  if (ctx.status !== "ok") return redirect("/auth/login");

  const sale = await getSaleDetail({ tenantId: ctx.context.tenantId, saleId: resolvedParams.id });
  if (!sale) notFound();

  const completed = sale.status === "COMPLETED";
  // PERMISSIONS.md puts returns with the manager. Mirrored here only so the button is honest;
  // `createReturn` enforces it regardless of what this page renders.
  const mayReturn = canAuthorizeReturn({
    tenantRole: ctx.context.tenantRole,
    membershipRole: ctx.context.membershipRole,
  });
  const isPosted = sale.erpSyncStatus === "SYNCED" || sale.erpSyncStatus === "POSTED" || sale.erpSyncStatus === "SUCCESS";
  const erpTone: Tone = isPosted ? "success" : sale.erpSyncStatus === "FAILED" ? "danger" : "warning";
  const erpText = isPosted ? "Submitted" : sale.erpSyncStatus === "FAILED" ? "Failed" : "Pending";
  const units = sale.items.reduce((n, i) => n + i.quantity, 0);
  const balanceMinor = sale.totalMinor - sale.paidMinor;

  const receiptData = {
    storeName: sale.storeName,
    storeAddress: [sale.storeAddressLine, sale.storeCity, sale.storeState, sale.storePostalCode].filter(Boolean).join(", "),
    storeGstin: null,
    storeState: sale.storeState,
    storeStateCode: "29", // Standard default (Karnataka / state code)
    billNumber: sale.billNumber,
    date: sale.completedAt,
    cashierName: sale.cashierName,
    terminalName: sale.posTerminal,
    customerName: sale.customer?.name ?? null,
    customerPhone: sale.customer?.phone ?? null,
    customerGstin: sale.customer?.gstin ?? null,
    customerAddress: null,
    placeOfSupply: sale.storeState,
    items: sale.items.map((i) => ({
      name: i.name,
      variant: [i.size, i.colour].filter(Boolean).join(" / ") || null,
      sku: i.sku,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      gstRateBp: i.taxRateBp,
      totalMinor: i.lineTotalMinor,
    })),
    subtotalMinor: sale.subtotalMinor,
    discountMinor: sale.discountMinor,
    cgstMinor: Math.round(sale.taxMinor / 2),
    sgstMinor: Math.round(sale.taxMinor / 2),
    totalMinor: sale.totalMinor,
    payments: sale.payments.map((p) => ({
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference,
    })),
    footerMessage: "Thank you for shopping! Exchange valid for 7 days with original tag & bill.",
  };

  const isOwnerOrManager = ctx.context.tenantRole === "OWNER" || ctx.context.membershipRole === "STORE_MANAGER";
  const approvers = await listApprovers({ tenantId: ctx.context.tenantId, storeId: ctx.context.storeId }).catch(() => []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const saleDay = new Date(sale.completedAt);
  saleDay.setHours(0, 0, 0, 0);
  const isSameDay = saleDay.getTime() === today.getTime();

  return (
    <div className="w-full min-w-0 p-4 sm:p-5 print:p-0">
      {/* -------------------------------------------------------- header */}
      <div className="cust-rise mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] print:hidden">
            <Link href="/sales" className="text-tertiary hover:text-primary hover:underline">
              Sales &amp; Transactions
            </Link>
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-tertiary" />
            <span className="text-primary">Bill Details</span>
          </nav>
          <h1 className="mt-1.5 text-[26px] font-bold tracking-tight text-primary">Bill Details</h1>
          <p className="mt-0.5 text-[15px] text-tertiary">View complete transaction details, items, payments and history</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 print:hidden">
          <PrintButton receiptData={receiptData} />
          <WhatsAppReceiptButton
            billNumber={sale.billNumber}
            customerName={sale.customer?.name}
            customerPhone={sale.customer?.phone}
            storeName={sale.storeName}
            totalMinor={sale.totalMinor}
          />
          <DownloadPdfButton billNumber={sale.billNumber} />
          <ShareReceiptButton
            billNumber={sale.billNumber}
            totalFormatted={formatMinor(sale.totalMinor)}
            storeName={sale.storeName}
          />
          <ReturnAction saleId={sale.id} completed={completed} authorised={mayReturn} />
          <ExchangeAction saleId={sale.id} completed={completed} authorised={mayReturn} />
          {completed && (
            <CancelBillModal
              saleId={sale.id}
              billNumber={sale.billNumber}
              approvers={approvers}
              isOwnerOrManager={isOwnerOrManager}
              isSameDay={isSameDay}
            />
          )}
          <button type="button" disabled title="More actions are not available yet" className={`${ACTION} cursor-not-allowed text-tertiary`}>
            More <ChevronDown aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only"> (not available yet)</span>
          </button>
        </div>
      </div>

      {/*
        One grid, row by row, so every left-hand box shares a row with its right-hand partner
        and both stretch to the same height: summary with customer, items with the session,
        payments and totals with the posting state. The actions row spans both columns.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
          {/* Summary strip */}
          <section
            aria-label="Bill summary"
            className="cust-rise flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-background-card px-4 py-4 shadow-sm print:shadow-none"
            style={{ ["--i" as string]: 1 }}
          >
            <div className="flex min-w-0 items-center gap-4 pr-6 lg:border-r lg:border-border">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-full ${completed ? "bg-success-subtle text-success" : "bg-background-hover text-tertiary"}`}>
                  {completed ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}
                </span>
                <Pill tone={completed ? "success" : "neutral"}>{completed ? "Completed" : "Voided"}</Pill>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-tertiary">Bill No.</p>
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-[22px] font-bold tracking-tight text-primary">{sale.billNumber}</p>
                  <CopyButton text={sale.billNumber} title="Copy bill number" />
                </div>
                <time dateTime={sale.completedAt.toISOString()} className="text-[11px] text-secondary">
                  {formatDateTime(sale.completedAt)}
                </time>
              </div>
            </div>
            <dl className="flex flex-wrap items-start gap-x-10 gap-y-3 text-[11px]">
              <div>
                <dt className="text-tertiary">Invoice Sync</dt>
                <dd className={`mt-1.5 text-[13px] ${isPosted && sale.erpInvoiceId ? "text-primary-active" : "text-secondary"}`}>
                  {isPosted && sale.erpInvoiceId ? sale.erpInvoiceId : "Pending sync"}
                </dd>
              </div>
              <div>
                <dt className="text-tertiary">Order Type</dt>
                <dd className="mt-1.5 text-[13px] text-primary">{sale.customer ? "Named customer" : "Walk-in"}</dd>
              </div>
              <div>
                <dt className="text-tertiary">Items</dt>
                <dd className="mt-1.5 text-[13px] text-primary">
                  {units} {units === 1 ? "unit" : "units"}
                </dd>
              </div>
              <div>
                <dt className="text-tertiary">Cashier</dt>
                <dd className="mt-1 flex items-center gap-2.5">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-subtle text-[13px] font-semibold text-primary-active">
                    {initials(sale.cashierName)}
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium text-primary">{sale.cashierName}</span>
                    <span className="block text-[11px] text-tertiary">Cashier</span>
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <Card
            title="Customer"
            index={8}
            action={
              <button type="button" disabled title="Editing the bill's customer is not available yet" className="inline-flex h-7 cursor-not-allowed items-center rounded-md border border-border px-2 text-[11px] text-tertiary">
                Edit
              </button>
            }
          >
            <div className="flex items-center gap-3 px-4 pb-4 pt-1">
              <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[18px] font-bold text-primary-active">
                {sale.customer ? initials(sale.customer.name) : <UserRound className="h-6 w-6" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-primary">{sale.customer ? sale.customer.name : "Walk-in Customer"}</p>
                <p className="truncate text-[11px] tabular-nums text-tertiary">
                  {sale.customer ? sale.customer.phone || "No phone on file" : "No customer was attached to this bill"}
                </p>
              </div>
            </div>
          </Card>

          <Card
            title={`Items (${sale.items.length})`}
            index={2}
            action={
              <GstSummaryButton
                items={sale.items.map((i) => ({
                  name: i.name,
                  sku: i.sku,
                  taxRateBp: i.taxRateBp,
                  taxMinor: i.taxMinor,
                  lineTotalMinor: i.lineTotalMinor,
                  taxTreatment: i.taxTreatment,
                }))}
                subtotalMinor={sale.subtotalMinor}
                totalTaxMinor={sale.taxMinor}
                placeOfSupply={sale.storeState}
                billNumber={sale.billNumber}
              />
            }
          >
            {/* Fixed-layout table from md up — fits its box, never scrolls sideways. */}
            <div className="hidden px-3 pb-3 md:block">
              <table className="w-full table-fixed text-[11px]">
                <caption className="sr-only">Items on this bill</caption>
                <thead>
                  <tr className="text-left text-[11px] font-semibold text-secondary">
                    <th scope="col" className="w-8 rounded-l-md bg-background-subtle px-2 py-2.5">#</th>
                    <th scope="col" className="bg-background-subtle px-2 py-2.5">Product</th>
                    <th scope="col" className="hidden w-[90px] bg-background-subtle px-2 py-2.5 lg:table-cell">SKU</th>
                    <th scope="col" className="hidden w-[90px] bg-background-subtle px-2 py-2.5 xl:table-cell">Variant</th>
                    <th scope="col" className="w-11 bg-background-subtle px-2 py-2.5 text-center">Qty</th>
                    <th scope="col" className="w-[84px] bg-background-subtle px-2 py-2.5 text-right">Price (₹)</th>
                    <th scope="col" className="w-[84px] bg-background-subtle px-2 py-2.5 text-right">Discount (₹)</th>
                    <th scope="col" className="w-[72px] bg-background-subtle px-2 py-2.5 text-right">GST (₹)</th>
                    <th scope="col" className="w-[92px] rounded-r-md bg-background-subtle px-3 py-2.5 text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item, i) => {
                    const variant = [item.size, item.colour].filter(Boolean).join(" / ");
                    return (
                      <tr key={item.id} className="cust-row cust-rise border-b border-border last:border-0 hover:bg-background-subtle" style={{ ["--i" as string]: i }}>
                        <td className="px-2 py-2 text-secondary">{i + 1}</td>
                        <td className="px-2 py-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background-hover">
                              {item.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <Package aria-hidden="true" className="h-4 w-4 text-disabled" />
                              )}
                            </span>
                            <p className="min-w-0 truncate font-medium text-primary" title={item.name}>
                              {item.name}
                            </p>
                          </div>
                        </td>
                        <td className="hidden truncate px-2 py-2 text-secondary lg:table-cell">{item.sku}</td>
                        <td className="hidden truncate px-2 py-2 text-secondary xl:table-cell">{variant || "—"}</td>
                        <td className="px-2 py-2 text-center tabular-nums text-secondary">{item.quantity}</td>
                        <td className="truncate px-2 py-2 text-right tabular-nums text-secondary">{formatMinor(item.unitPriceMinor).replace("₹", "")}</td>
                        <td className="truncate px-2 py-2 text-right tabular-nums text-secondary">{formatMinor(item.lineDiscountMinor).replace("₹", "")}</td>
                        <td className="truncate px-2 py-2 text-right tabular-nums text-secondary">
                          {gstTypeLabel(item.taxTreatment) ?? formatMinor(item.taxMinor).replace("₹", "")}
                        </td>
                        <td className="truncate px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-primary">{formatMinor(item.lineTotalMinor).replace("₹", "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Cards below md. */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {sale.items.map((item, i) => {
                const variant = [item.size, item.colour].filter(Boolean).join(" / ");
                return (
                  <li key={item.id} className="cust-rise flex gap-3 px-4 py-3" style={{ ["--i" as string]: i }}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-hover">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package aria-hidden="true" className="h-4 w-4 text-disabled" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-primary">{item.name}</p>
                      <p className="truncate text-[10px] text-tertiary">
                        {item.sku}
                        {variant ? ` · ${variant}` : ""}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                        <span className="truncate tabular-nums text-secondary">
                          {item.quantity} × {formatMinor(item.unitPriceMinor)} · {gstTypeLabel(item.taxTreatment) ?? `tax ${formatMinor(item.taxMinor)}`}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-primary">{formatMinor(item.lineTotalMinor)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Store & Session" index={9}>
            <dl className="pb-3">
              <Row label="Store">
                {sale.storeName} (#{sale.storeCode})
              </Row>
              <Row label="POS Terminal">{sale.posTerminal || "—"}</Row>
              <Row label="Shift">{sale.posShiftStart ? `Opened ${formatDateTime(sale.posShiftStart)}` : "—"}</Row>
              <Row label="Cashier">
                {sale.cashierName} ({initials(sale.cashierName)})
              </Row>
            </dl>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
            <Card title="Payment Information" index={3}>
              <div className="px-3 pb-3">
                <table className="w-full table-fixed text-[11px]">
                  <caption className="sr-only">Payments on this bill</caption>
                  <thead>
                    <tr className="text-left text-[11px] font-semibold text-secondary">
                      <th scope="col" className="w-8 rounded-l-md bg-background-subtle px-2 py-2.5">#</th>
                      <th scope="col" className="hidden bg-background-subtle px-2 py-2.5 sm:table-cell">Date &amp; Time</th>
                      <th scope="col" className="w-[72px] bg-background-subtle px-2 py-2.5">Method</th>
                      <th scope="col" className="bg-background-subtle px-2 py-2.5">Reference No.</th>
                      <th scope="col" className="w-[92px] bg-background-subtle px-2 py-2.5 text-right">Amount (₹)</th>
                      <th scope="col" className="w-[92px] rounded-r-md bg-background-subtle px-2 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sale.payments.map((p, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-2 py-3 text-secondary">{i + 1}</td>
                        <td className="hidden truncate px-2 py-3 text-secondary sm:table-cell">{p.confirmedAt ? formatDateTime(p.confirmedAt) : "Not confirmed"}</td>
                        <td className="px-2 py-3">
                          <Pill tone={p.method === "UPI" ? "info" : p.method === "CASH" ? "success" : "neutral"}>{methodLabel(p.method)}</Pill>
                        </td>
                        <td className="truncate px-2 py-3 text-secondary">{p.reference || "—"}</td>
                        <td className="px-2 py-3 text-right text-[13px] font-semibold tabular-nums text-primary">{formatMinor(p.amountMinor).replace("₹", "")}</td>
                        <td className="px-2 py-3">
                          <Pill tone={p.status === "CONFIRMED" ? "success" : "warning"} dot>
                            {p.status === "CONFIRMED" ? "Success" : p.status.toLowerCase()}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Summary" index={4}>
              <dl className="space-y-1.5 px-4 pb-2 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-tertiary">Items Total</dt>
                  <dd className="tabular-nums text-primary">{formatMinor(sale.totalMinor + sale.discountMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-tertiary">Discount</dt>
                  <dd className={`tabular-nums ${sale.discountMinor > 0 ? "text-danger" : "text-primary"}`}>
                    {sale.discountMinor > 0 ? `-${formatMinor(sale.discountMinor)}` : formatMinor(0)}
                  </dd>
                </div>
                {sale.discountMinor > 0 && sale.discountReason && (
                  <p className="-mt-0.5 text-[10px] text-tertiary">
                    {sale.discountReason}
                    {sale.discountAuthorisedByName ? ` · authorised by ${sale.discountAuthorisedByName}` : ""}
                  </p>
                )}
                <div className="flex justify-between">
                  <dt className="text-tertiary">Taxable value</dt>
                  <dd className="tabular-nums text-primary">{formatMinor(sale.subtotalMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-tertiary">GST (included)</dt>
                  <dd className="tabular-nums text-primary">{formatMinor(sale.taxMinor)}</dd>
                </div>
              </dl>
              <div className="mx-3 flex items-baseline justify-between rounded-md bg-background-subtle px-2 py-2">
                <span className="text-[16px] font-bold text-primary">Grand Total</span>
                <span className="text-[18px] font-bold tabular-nums text-primary">{formatMinor(sale.totalMinor)}</span>
              </div>
              <dl className="m-3 space-y-1 rounded-md border border-success-subtle bg-success-subtle/70 px-2 py-2 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-emerald-800">Amount Paid</dt>
                  <dd className="font-semibold tabular-nums text-emerald-800">{formatMinor(sale.paidMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-emerald-800">Balance Due</dt>
                  <dd className={`font-semibold tabular-nums ${balanceMinor > 0 ? "text-danger" : "text-emerald-800"}`}>{formatMinor(balanceMinor)}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card title="Additional Information" index={10}>
            <dl className="pb-3">
              <Row label="Payment Status">
                <Pill tone={balanceMinor <= 0 ? "success" : "warning"}>{balanceMinor <= 0 ? "Paid" : "Partial"}</Pill>
              </Row>
              <Row label="Invoice Status">
                <Pill tone={erpTone}>{erpText}</Pill>
              </Row>
              <Row label="Created On">{formatDateTime(sale.createdAt)}</Row>
              <Row label="Completed On">{formatDateTime(sale.completedAt)}</Row>
              <Row label="Synced Invoice">
                {sale.erpInvoiceId ? (
                  <span className="inline-flex items-center gap-1 text-primary-active">
                    {sale.erpInvoiceId}
                    <CopyButton text={sale.erpInvoiceId} title="Copy synced invoice number" />
                  </span>
                ) : (
                  "—"
                )}
              </Row>
            </dl>
          </Card>
          <div className="grid gap-4 print:hidden lg:col-span-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.05fr)_minmax(0,1.45fr)]">
            <Card title="Actions" index={5}>
              <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3 [&_button]:gap-1.5 [&_button]:px-2 [&_button]:text-[11px]">
                <PrintButton variant="tile" receiptData={receiptData} />
                <PendingAction icon={<Mail className="h-4 w-4" />} label="Email Bill" />
                <PendingAction icon={<MessageCircle className="h-4 w-4" />} label="WhatsApp" />
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-3">
                  <ReturnAction saleId={sale.id} completed={completed} authorised={mayReturn} tile />
                  {completed ? (
                    <CancelBillModal
                      saleId={sale.id}
                      billNumber={sale.billNumber}
                      approvers={approvers}
                      isOwnerOrManager={isOwnerOrManager}
                      isSameDay={isSameDay}
                      tile
                    />
                  ) : (
                    <button type="button" disabled title="Bill is voided" className={`${ACTION} cursor-not-allowed justify-center border-slate-200 bg-slate-50 text-slate-400`}>
                      <XCircle aria-hidden="true" className="h-4 w-4" />
                      Voided
                    </button>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Related" index={6}>
              <ul className="space-y-1 px-4 pb-4 text-[11px]">
                <li>
                  <span className="flex items-center gap-2.5 py-1 text-tertiary" title="No accounting connection yet">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" /> View in Accounting
                  </span>
                </li>
                <li>
                  <span className="flex items-center gap-2.5 py-1 text-tertiary" title="Bills record the customer by name only">
                    <History aria-hidden="true" className="h-4 w-4" /> Customer Purchase History
                  </span>
                </li>
                <li>
                  <Link href="/products" className="flex items-center gap-2.5 py-1 text-primary hover:text-primary-active">
                    <ShoppingBag aria-hidden="true" className="h-4 w-4 text-tertiary" /> Similar Products
                  </Link>
                </li>
                <li>
                  <Link href="/pos" className="flex items-center gap-2.5 py-1 text-primary hover:text-primary-active">
                    <PlusCircle aria-hidden="true" className="h-4 w-4 text-tertiary" /> Create New Sale
                  </Link>
                </li>
                <li>
                  {completed && mayReturn ? (
                    <Link href={`/sales/${sale.id}/exchange`} className="flex items-center gap-2.5 py-1 text-primary hover:text-primary-active">
                      <Repeat aria-hidden="true" className="h-4 w-4 text-indigo-600" /> Apply for Exchange
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2.5 py-1 text-tertiary" title="Only completed bills can be exchanged">
                      <Repeat aria-hidden="true" className="h-4 w-4" /> Apply for Exchange
                    </span>
                  )}
                </li>
              </ul>
            </Card>

            <Card title="Activity Timeline" index={7}>
              <ol className="space-y-2.5 px-4 pb-4 text-[11px]">
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full border-[3px] border-emerald-500 bg-background-card" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-primary">Bill Created</p>
                    <p className="text-[11px] text-tertiary">{formatDateTime(sale.createdAt)}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-tertiary">{sale.cashierName}</span>
                </li>
                {sale.payments.map((p, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full border-[3px] border-border-focus bg-background-card" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-primary">Payment Received ({methodLabel(p.method)})</p>
                      <p className="text-[11px] text-tertiary">{p.confirmedAt ? formatDateTime(p.confirmedAt) : "—"}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-primary">{formatMinor(p.amountMinor)}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className={`mt-0.5 h-3 w-3 shrink-0 rounded-full border-[3px] bg-background-card ${isPosted ? "border-emerald-500" : "border-border"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${isPosted ? "text-primary" : "text-tertiary"}`}>{isPosted ? "Invoice synced to accounting" : "Not yet posted to accounting"}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-tertiary">System</span>
                </li>
              </ol>
            </Card>
          </div>
      </div>
    </div>
  );
}


