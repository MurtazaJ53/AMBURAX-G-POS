import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  Clock,
  FileText,
  HandCoins,
  IndianRupee,
  MessageCircle,
  Users,
  WalletCards,
} from "lucide-react";
import { env } from "@/lib/env";
import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getCustomerSummary, type CustomerSummary } from "@/server/sales/customers";
import { getKhataBook, KhataInconsistentError, type KhataBook } from "@/server/khata/khataBook";
import { formatMinor } from "@/server/sales/saleTotals";
import { CustomerActions } from "../customers/CustomerClient";
import { KhataBookClient } from "./KhataBookClient";

/**
 * Customer Due & Khata screen.
 *
 * Scoped strictly to the legal Company and currency of the authorized Store in session.
 * Dues, payments, and ageing are authoritative from completed sales, payments, and ledger entries.
 * Unmapped stores fail closed with a clear unavailable state.
 */

const KPI_TONES = {
  sky: "bg-primary-subtle text-primary",
  teal: "bg-info-subtle text-info",
  blue: "bg-primary-subtle text-primary",
  rose: "bg-danger-subtle text-rose-500",
  violet: "bg-info-subtle text-info",
} as const;

function Kpi(props: {
  index: number;
  tone: keyof typeof KPI_TONES;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  muted?: boolean;
}) {
  return (
    <div
      className="cust-rise flex min-w-0 items-center gap-4 rounded-xl border border-border bg-background-card px-4 py-3.5 shadow-sm xl:h-[100px]"
      style={{ ["--i" as string]: props.index }}
    >
      <span
        aria-hidden="true"
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${KPI_TONES[props.tone]}`}
      >
        {props.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-secondary">{props.label}</p>
        <p
          className={`truncate text-[22px] font-bold leading-tight tracking-tight tabular-nums ${
            props.muted ? "text-slate-300" : "text-primary"
          }`}
        >
          {props.value}
        </p>
        <p className="truncate text-[11px] text-tertiary">{props.hint}</p>
      </div>
    </div>
  );
}

function Card(props: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  index: number;
  className?: string;
}) {
  const id = `khata-${props.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={`cust-rise min-w-0 overflow-hidden rounded-xl border border-border bg-background-card shadow-sm ${
        props.className ?? ""
      }`}
      style={{ ["--i" as string]: props.index }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h2 id={id} className="text-[16px] font-bold text-primary">
          {props.title}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export default async function KhataPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("khata: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");

  let summary: CustomerSummary;
  try {
    summary = await getCustomerSummary({ tenantId: resolved.context.tenantId });
  } catch (err) {
    logError("khata: load customer summary failed", err);
    return <ServiceUnavailableScreen />;
  }

  // Resolve store's legal company and currency mapping
  const store = await db.store.findUnique({
    where: { id_tenantId: { id: resolved.context.storeId, tenantId: resolved.context.tenantId } },
    select: {
      id: true,
      name: true,
      currency: true,
      companyId: true,
      company: {
        select: {
          id: true,
          name: true,
          currency: true,
        },
      },
    },
  });

  // If the store has no explicit company/currency mapping, fail closed with a clear unavailable state
  if (!store || !store.companyId || !store.company || !store.currency || store.currency !== store.company.currency) {
    return (
      <div className="w-full min-w-0 p-4 sm:p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-tight text-primary">Customer Due &amp; Khata</h1>
            <p className="mt-0.5 text-[15px] text-tertiary">
              Track outstanding dues, manage khata and follow up with customers
            </p>
          </div>
          <CustomerActions variant="khata" />
        </header>

        <section aria-label="Khata summary" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            index={0}
            tone="sky"
            icon={<Users className="h-6 w-6" />}
            label="Total Customers"
            value={summary.total.toLocaleString("en-IN")}
            hint={`${summary.active.toLocaleString("en-IN")} active`}
          />
          <Kpi index={1} tone="teal" icon={<IndianRupee className="h-6 w-6" />} label="Total Due Amount" value="—" hint="Scope unmapped" muted />
          <Kpi index={2} tone="blue" icon={<WalletCards className="h-6 w-6" />} label="Active Khata" value="—" hint="Scope unmapped" muted />
          <Kpi index={3} tone="rose" icon={<Clock className="h-6 w-6" />} label="Overdue Customers" value="—" hint="Scope unmapped" muted />
          <Kpi index={4} tone="violet" icon={<CalendarClock className="h-6 w-6" />} label="Avg. Days Pending" value="—" hint="Scope unmapped" muted />
        </section>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-6 w-6 text-amber-600 shrink-0" />
            <div>
              <h2 className="text-[17px] font-bold text-amber-900">Khata Unavailable for this Store</h2>
              <p className="mt-1 text-[13px] text-amber-800">
                This store (<span className="font-semibold">{store?.name ?? resolved.context.storeName}</span>) is not mapped to an authorized legal company and currency. Khata customer dues require explicit company scoping to prevent cross-company ledger attribution.
              </p>
              <p className="mt-2 text-[12px] text-amber-700">
                Please contact an administrator to configure legal company and currency mapping before viewing customer dues.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  let book: KhataBook;
  try {
    book = await getKhataBook({
      tenantId: resolved.context.tenantId,
      companyId: store.companyId,
      currency: store.currency,
    });
  } catch (err) {
    logError("khata: load book failed", err);
    if (err instanceof KhataInconsistentError) {
      return (
        <div className="w-full min-w-0 p-4 sm:p-5">
          <h1 className="mb-4 text-[26px] font-bold tracking-tight text-primary">Customer Due &amp; Khata</h1>
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
              <div>
                <h2 className="text-[17px] font-bold">Khata Balances Unavailable</h2>
                <p className="mt-1 text-[13px] text-rose-800">
                  Stored payments, allocations, refunds or ledger entries for {store.company.name} ({store.currency}) do not
                  reconcile with their sales ({err.issues.length} issue{err.issues.length === 1 ? "" : "s"}). Dues are
                  withheld rather than shown as a possibly wrong amount.
                </p>
                <p className="mt-2 text-[12px] text-rose-700">Please contact an administrator to review the khata records.</p>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <ServiceUnavailableScreen />;
  }

  const ageColours = ["#2563eb", "#f59e0b", "#22c55e", "#f43f5e", "#8b5cf6"];
  const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const quickActions = [
    { label: "View All Dues", hint: "See complete pending dues", icon: <FileText className="h-5 w-5" />, tone: "bg-primary-subtle text-primary" },
    { label: "Send Due Reminder", hint: "WhatsApp / SMS / Call", icon: <MessageCircle className="h-5 w-5" />, tone: "bg-success-subtle text-success" },
    { label: "Create Khata", hint: "Open new khata for customer", icon: <Building2 className="h-5 w-5" />, tone: "bg-warning-subtle text-warning" },
    { label: "Collect Payment", hint: "Oldest bill first", href: "/khata/collect", icon: <HandCoins className="h-5 w-5" />, tone: "bg-info-subtle text-info" },
  ];

  return (
    <div className="w-full min-w-0 p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-bold tracking-tight text-primary">Customer Due &amp; Khata</h1>
            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              {store.company.name} ({store.currency})
            </span>
          </div>
          <p className="mt-0.5 text-[15px] text-tertiary">
            Track outstanding dues, manage khata and follow up with customers
          </p>
        </div>
        <CustomerActions variant="khata" />
      </header>

      <section aria-label="Khata summary" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          index={0}
          tone="sky"
          icon={<Users className="h-6 w-6" />}
          label="Total Customers"
          value={summary.total.toLocaleString("en-IN")}
          hint={`${summary.active.toLocaleString("en-IN")} active`}
        />
        <Kpi
          index={1}
          tone="teal"
          icon={<IndianRupee className="h-6 w-6" />}
          label="Total Due Amount"
          value={formatMinor(book.totalDueMinor)}
          hint={`${book.activeKhata} customer${book.activeKhata === 1 ? "" : "s"} owe`}
        />
        <Kpi
          index={2}
          tone="blue"
          icon={<WalletCards className="h-6 w-6" />}
          label="Active Khata"
          value={book.activeKhata.toLocaleString("en-IN")}
          hint="Open credit accounts"
        />
        <Kpi
          index={3}
          tone="rose"
          icon={<Clock className="h-6 w-6" />}
          label="Overdue Customers"
          value={book.overdueCustomers.toLocaleString("en-IN")}
          hint={book.overdueCustomers > 0 ? "Exceeded payment terms" : "Zero past terms"}
        />
        <Kpi
          index={4}
          tone="violet"
          icon={<CalendarClock className="h-6 w-6" />}
          label="Avg. Days Pending"
          value={`${book.avgDaysPending} day${book.avgDaysPending === 1 ? "" : "s"}`}
          hint="From oldest open bill"
        />
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Customer Due Overview" index={5} className="flex flex-col">
          <div className="flex flex-1 items-center gap-6 px-4 pb-4">
            <div aria-hidden="true" className="relative size-[136px] shrink-0 rounded-full border-[18px] border-border">
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[17px] font-bold text-primary">{formatMinor(book.totalDueMinor)}</span>
                <span className="text-[11px] text-tertiary">Total Due</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2.5 text-[11px]">
              {book.ageing.map((b, i) => (
                <li key={b.label} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: ageColours[i] }} />
                  <span className="w-24 text-secondary">{b.label}</span>
                  <span className="ml-auto font-semibold tabular-nums text-primary">{formatMinor(b.minor)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card
          title="Due Amount Trend"
          index={6}
          className="flex flex-col"
          action={<span className="rounded-md border border-border px-2.5 py-1 text-[11px] text-tertiary">Last 6 Months</span>}
        >
          <div className="flex flex-1 items-center justify-around px-4 pb-4">
            {book.trend.map((t) => (
              <div key={t.month} className="flex flex-col items-center gap-1 text-[11px]">
                <span className="font-semibold text-secondary">{t.month}</span>
                <span className="text-amber-700 tabular-nums">+{formatMinor(t.givenMinor)}</span>
                <span className="text-emerald-700 tabular-nums">−{formatMinor(t.collectedMinor)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Interactive Khata Book with Customer Table & Customer Details */}
      <div className="mb-4">
        <KhataBookClient customers={book.customers} storeName={store.name} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card title="Recent Payments" index={9} className="flex flex-col">
          {book.recentPayments.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[12.5px] text-secondary">
              No recent khata payments recorded for this legal company.
            </div>
          ) : (
            <div className="overflow-x-auto px-3 pb-3">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-secondary">
                    <th className="py-2">Date</th>
                    <th className="py-2">Customer</th>
                    <th className="py-2">Method</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {book.recentPayments.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="py-2 text-secondary">{dateFmt.format(new Date(p.at))}</td>
                      <td className="py-2 font-medium text-primary">{p.customerName}</td>
                      <td className="py-2 text-secondary">{p.method}</td>
                      <td className="py-2 text-right font-semibold text-emerald-700">{formatMinor(p.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Quick Actions" index={10}>
          <ul className="space-y-1 px-3 pb-3">
            {quickActions.map((a) => (
              <li key={a.label}>
                {"href" in a && a.href ? (
                  <Link
                    href={a.href}
                    className="amb-focus flex w-full items-center gap-3 rounded-lg border-b border-border px-2 py-2.5 text-left transition-colors last:border-0 hover:bg-background-subtle"
                  >
                    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${a.tone}`}>
                      {a.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-primary">{a.label}</span>
                      <span className="block truncate text-[11px] text-tertiary">{a.hint}</span>
                    </span>
                  </Link>
                ) : (
                <button
                  type="button"
                  disabled
                  title={`${a.label} — payment mutation actions disabled`}
                  className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg border-b border-border px-2 py-2.5 text-left opacity-75 last:border-0"
                >
                  <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg opacity-70 ${a.tone}`}>
                    {a.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-secondary">{a.label}</span>
                    <span className="block truncate text-[11px] text-tertiary">{a.hint}</span>
                  </span>
                </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
