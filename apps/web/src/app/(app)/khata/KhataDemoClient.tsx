import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  BookOpen,
  CalendarClock,
  CalendarRange,
  Clock,
  FileText,
  Filter,
  HandCoins,
  IndianRupee,
  MessageCircle,
  Search,
  Users,
  WalletCards,
} from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getCustomerSummary, type CustomerSummary } from "@/server/sales/customers";
import { CustomerActions } from "../customers/CustomerClient";

/**
 * Customer Due & Khata, laid out as the Phase-2 reference.
 *
 * AMBURAX has no receivables ledger: dues, collections, ageing and reminders come from ERP
 * receivables, which are not connected. So this screen draws the reference's structure and
 * fills only what is real — the customer count — while every due figure reads "Awaiting ERP"
 * and every action is disabled and labelled. An estimated balance would be the one number a
 * shopkeeper might act on, so none is invented.
 */

const AWAIT = "Awaiting sync";

const KPI_TONES = {
  sky: "bg-primary-subtle text-primary",
  teal: "bg-info-subtle text-info",
  blue: "bg-primary-subtle text-primary",
  rose: "bg-danger-subtle text-rose-500",
  violet: "bg-info-subtle text-info",
} as const;

function Kpi(props: { index: number; tone: keyof typeof KPI_TONES; icon: React.ReactNode; label: string; value: string; hint: string; muted?: boolean }) {
  return (
    <div
      className="cust-rise flex min-w-0 items-center gap-4 rounded-xl border border-border bg-background-card px-4 py-3.5 shadow-sm xl:h-[100px]"
      style={{ ["--i" as string]: props.index }}
    >
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${KPI_TONES[props.tone]}`}>
        {props.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-secondary">{props.label}</p>
        <p className={`truncate text-[22px] font-bold leading-tight tracking-tight tabular-nums ${props.muted ? "text-slate-300" : "text-primary"}`}>
          {props.value}
          {props.muted && <span className="sr-only"> (not available: accounting sync not connected)</span>}
        </p>
        <p className="truncate text-[11px] text-tertiary">{props.hint}</p>
      </div>
    </div>
  );
}

function Card(props: { title: string; action?: React.ReactNode; children: React.ReactNode; index: number; className?: string }) {
  const id = `khata-${props.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={`cust-rise min-w-0 overflow-hidden rounded-xl border border-border bg-background-card shadow-sm ${props.className ?? ""}`}
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

function Pending({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-secondary">{children}</p>
      <p className="mt-1 text-[11px] text-tertiary">The accounting sync is not connected yet.</p>
    </div>
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
    logError("khata: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const ageing = ["0 - 7 Days", "8 - 15 Days", "16 - 30 Days", "31 - 60 Days", "> 60 Days"];
  const ageColours = ["#2563eb", "#f59e0b", "#22c55e", "#f43f5e", "#8b5cf6"];
  const quickActions = [
    { label: "View All Dues", hint: "See complete pending dues", icon: <FileText className="h-5 w-5" />, tone: "bg-primary-subtle text-primary" },
    { label: "Send Due Reminder", hint: "WhatsApp / SMS / Call", icon: <MessageCircle className="h-5 w-5" />, tone: "bg-success-subtle text-success" },
    { label: "Create Khata", hint: "Open new khata for customer", icon: <BookOpen className="h-5 w-5" />, tone: "bg-warning-subtle text-warning" },
    { label: "Collect Payment", hint: "Record customer payment", icon: <HandCoins className="h-5 w-5" />, tone: "bg-info-subtle text-info" },
  ];

  return (
    <div className="w-full min-w-0 p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-primary">Customer Due &amp; Khata</h1>
          <p className="mt-0.5 text-[15px] text-tertiary">Track outstanding dues, manage khata and follow up with customers</p>
        </div>
        <CustomerActions variant="khata" />
      </header>

      <section aria-label="Khata summary" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi index={0} tone="sky" icon={<Users className="h-6 w-6" />} label="Total Customers" value={summary.total.toLocaleString("en-IN")} hint={`${summary.active.toLocaleString("en-IN")} active`} />
        <Kpi index={1} tone="teal" icon={<IndianRupee className="h-6 w-6" />} label="Total Due Amount" value="—" hint={AWAIT} muted />
        <Kpi index={2} tone="blue" icon={<WalletCards className="h-6 w-6" />} label="Active Khata" value="—" hint={AWAIT} muted />
        <Kpi index={3} tone="rose" icon={<Clock className="h-6 w-6" />} label="Overdue Customers" value="—" hint={AWAIT} muted />
        <Kpi index={4} tone="violet" icon={<CalendarClock className="h-6 w-6" />} label="Avg. Days Pending" value="—" hint={AWAIT} muted />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Customer Due Overview" index={5} className="flex flex-col xl:h-[200px]">
              <div className="flex flex-1 items-center gap-6 px-4 pb-4">
                <div aria-hidden="true" className="relative size-[136px] shrink-0 rounded-full border-[18px] border-border">
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[17px] font-bold text-slate-300">—</span>
                    <span className="text-[11px] text-tertiary">Total Due</span>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-2.5 text-[11px]">
                  {ageing.map((band, i) => (
                    <li key={band} className="flex items-center gap-2">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: ageColours[i] }} />
                      <span className="w-24 text-secondary">{band}</span>
                      <span className="ml-auto text-tertiary">—</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Card
              title="Due Amount Trend"
              index={6}
              className="flex flex-col xl:h-[200px]"
              action={<span className="rounded-md border border-border px-2.5 py-1 text-[11px] text-tertiary">Last 6 Months</span>}
            >
              <Pending>No due history to chart</Pending>
            </Card>
          </div>

          <Card
            title="Customers with Due"
            index={7}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select disabled aria-label="Segment (not available yet)" className="h-9 cursor-not-allowed rounded-lg border border-border bg-background-card px-2.5 text-[11px] text-tertiary">
                  <option>All Segments</option>
                </select>
                <select disabled aria-label="Group (not available yet)" className="hidden h-9 cursor-not-allowed rounded-lg border border-border bg-background-card px-2.5 text-[11px] text-tertiary sm:block">
                  <option>All Groups</option>
                </select>
                <div className="relative hidden sm:block">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  <input disabled aria-label="Search customers with due (not available yet)" placeholder="Search customer..." className="h-9 w-56 cursor-not-allowed rounded-lg border border-border bg-background-card pl-8 pr-3 text-[11px] placeholder:text-slate-300" />
                </div>
                <button type="button" disabled aria-label="Filter (not available yet)" className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg border border-border text-slate-300">
                  <Filter className="h-4 w-4" />
                </button>
              </div>
            }
          >
            <div className="px-3 pb-3">
              <table className="w-full table-fixed text-[11px]">
                <caption className="sr-only">Customers with an outstanding due</caption>
                <thead>
                  <tr className="text-left text-[11px] font-semibold text-secondary">
                    <th scope="col" className="rounded-l-md bg-background-subtle px-3 py-2.5">Customer</th>
                    <th scope="col" className="hidden bg-background-subtle px-2 py-2.5 md:table-cell">Phone</th>
                    <th scope="col" className="hidden bg-background-subtle px-2 py-2.5 lg:table-cell">Khata No.</th>
                    <th scope="col" className="bg-background-subtle px-2 py-2.5">Total Due</th>
                    <th scope="col" className="hidden bg-background-subtle px-2 py-2.5 md:table-cell">Last Purchase</th>
                    <th scope="col" className="hidden bg-background-subtle px-2 py-2.5 lg:table-cell">Days Pending</th>
                    <th scope="col" className="bg-background-subtle px-2 py-2.5">Status</th>
                    <th scope="col" className="rounded-r-md bg-background-subtle px-2 py-2.5">Action</th>
                  </tr>
                </thead>
              </table>
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                  <BookOpen className="h-6 w-6" />
                </span>
                <p className="text-[13px] font-semibold text-primary">No khata balances to show</p>
                <p className="max-w-md text-[11px] text-secondary">
                  Dues come from the accounting sync, which is not connected yet. Your {summary.total.toLocaleString("en-IN")} customers and their
                  purchase history are on the Customers screen.
                </p>
                <Link href="/customers" className="mt-1 inline-flex h-9 items-center rounded-lg border border-sky-200 px-3 text-[13px] font-medium text-primary-active hover:bg-primary-subtle">
                  Open Customers (CRM)
                </Link>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Card title="Recent Payments" index={8} className="flex flex-col xl:h-[150px]">
              <Pending>No khata payments recorded</Pending>
            </Card>
            <Card title="Top Due Customers" index={9} className="flex flex-col xl:h-[150px]">
              <Pending>No dues to rank</Pending>
            </Card>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="Quick Actions" index={10}>
            <ul className="space-y-1 px-3 pb-3">
              {quickActions.map((a) => (
                <li key={a.label}>
                  <button
                    type="button"
                    disabled
                    title={`${a.label} — needs the accounting sync`}
                    className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg border-b border-border px-2 py-2.5 text-left last:border-0"
                  >
                    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg opacity-70 ${a.tone}`}>
                      {a.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-tertiary">
                        {a.label}
                        <span className="sr-only"> (not available yet)</span>
                      </span>
                      <span className="block truncate text-[11px] text-tertiary">{a.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Customer Khata Details" index={11}>
            <div className="flex flex-col items-center px-4 pb-6 pt-2 text-center">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-tertiary">
                <CalendarRange className="h-6 w-6" />
              </span>
              <p className="mt-3 text-[13px] font-medium text-secondary">No khata selected</p>
              <p className="mt-1 text-[11px] text-tertiary">Khata history, due summary and notes appear here once the accounting sync is connected.</p>
            </div>
          </Card>

          <section
            aria-labelledby="khata-reminders"
            className="cust-rise flex items-start gap-3 rounded-xl border border-sky-100 bg-primary-subtle/60 p-4"
            style={{ ["--i" as string]: 12 }}
          >
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-background-card text-primary">
              <CalendarClock className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 id="khata-reminders" className="text-[13px] font-bold text-primary">Send Due Reminders</h2>
              <p className="mt-0.5 text-[11px] text-secondary">Automatically remind customers about pending dues via WhatsApp, SMS or Call.</p>
              <button type="button" disabled title="Reminders need the accounting sync" className="mt-2.5 inline-flex h-9 cursor-not-allowed items-center rounded-lg bg-primary/40 px-4 text-[13px] font-semibold text-background-card">
                Send Reminders
                <span className="sr-only"> (not available yet)</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

