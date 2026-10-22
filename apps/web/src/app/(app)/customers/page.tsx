import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ChevronLeft, ChevronRight, IndianRupee, Repeat2, Search, Star, UserCheck, Users } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  listCustomers,
  getCustomerSummary,
  getCustomerDetail,
  getCustomerAnalytics,
  CUSTOMER_PAGE_SIZE,
  type CustomerAnalytics,
  type CustomerPage,
  type CustomerSummary,
  type CustomerDetail,
} from "@/server/sales/customers";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateOnly, formatDateTime } from "../sales/formatDateTime";
import { EmptyState, buttonClass } from "../_components/ui";
import type { CustomerType } from "@prisma/client";
import { CustomerActions, CustomerToolbar } from "./CustomerClient";
import { CustomerDetailPanel } from "./CustomerDetailPanel";
import { CustomerAvatar, SegmentPill } from "./customerUi";
import { CustomerPhoneCell } from "./CustomerPhoneCell";

/**
 * Customers (CRM), laid out as the Phase-2 reference: five headline cards, the views and
 * filters row, a dense directory beside the selected customer, and growth / top spenders /
 * segments underneath.
 *
 * Every figure is counted from real rows. The schema has no loyalty tier, VIP flag or
 * customer code, so "segments" are customer types and the reference's VIP badges and #C-001
 * codes are not drawn. Dues live on the Khata screen.
 */

const SEGMENTS: CustomerType[] = ["RETAIL", "WHOLESALE", "DISTRIBUTOR"];
const SEGMENT_COLOURS: Record<CustomerType, string> = {
  RETAIL: "#0284c7",
  WHOLESALE: "#8b5cf6",
  DISTRIBUTOR: "#f59e0b",
};
const SEGMENT_LABEL: Record<CustomerType, string> = { RETAIL: "Retail", WHOLESALE: "Wholesale", DISTRIBUTOR: "Distributor" };

function spendTier(spentMinor: number): { label: string; className: string } {
  if (spentMinor >= 5_000_000) return { label: "Platinum", className: "bg-purple-100 text-purple-800 border-purple-200" };
  if (spentMinor >= 2_000_000) return { label: "Gold", className: "bg-amber-100 text-amber-800 border-amber-200" };
  if (spentMinor >= 500_000) return { label: "Silver", className: "bg-slate-200 text-slate-800 border-slate-300" };
  return { label: "Bronze", className: "bg-orange-50 text-orange-800 border-orange-200" };
}

const KPI_TONES = {
  sky: "bg-primary-subtle text-primary",
  violet: "bg-info-subtle text-info",
  emerald: "bg-success-subtle text-success",
  teal: "bg-info-subtle text-info",
  amber: "bg-warning-subtle text-amber-500",
} as const;

function Kpi(props: { index: number; tone: keyof typeof KPI_TONES; icon: React.ReactNode; label: string; value: string; hint: React.ReactNode }) {
  return (
    <div
      className="cust-rise flex min-w-0 items-center gap-4 rounded-xl border border-border bg-background-card px-4 py-3.5 shadow-sm xl:h-[92px]"
      style={{ ["--i" as string]: props.index }}
    >
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${KPI_TONES[props.tone]}`}>
        {props.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-secondary">{props.label}</p>
        <p className="truncate text-[22px] font-bold leading-tight tracking-tight text-primary tabular-nums">{props.value}</p>
        <div className="truncate text-[13px] text-tertiary">{props.hint}</div>
      </div>
    </div>
  );
}

function pageWindow(page: number, count: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  for (let n = 1; n <= count; n += 1) {
    if (n === 1 || n === count || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; selected?: string; customerType?: string; status?: string; cohort?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const selectedId = sp.selected;
  const customerType = SEGMENTS.includes(sp.customerType as CustomerType) ? (sp.customerType as CustomerType) : "";
  // Same convention as the segment: an unrecognised value is ignored and the default view
  // (all of this tenant's customers) shows. "inactive" means strictly isActive = false.
  const status: "inactive" | "" = sp.status === "inactive" ? "inactive" : "";
  const cohort: "active" | "lapsed" | "new" | "" =
    sp.cohort === "active" || sp.cohort === "lapsed" || sp.cohort === "new" ? sp.cohort : "";

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("customers: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");
  const context = resolved.context;
  const isOwnerOrManager = context.tenantRole === "OWNER" || context.membershipRole === "STORE_MANAGER";

  let result: CustomerPage;
  let summary: CustomerSummary;
  let analytics: CustomerAnalytics;
  let detail: CustomerDetail | null = null;
  try {
    [result, summary, analytics] = await Promise.all([
      listCustomers({
        tenantId: context.tenantId,
        query,
        customerType: customerType || undefined,
        isActive: status === "inactive" ? false : undefined,
        cohort: cohort || undefined,
        page,
      }),
      getCustomerSummary({ tenantId: context.tenantId }),
      getCustomerAnalytics({ tenantId: context.tenantId }),
    ]);
    if (selectedId) {
      detail = await getCustomerDetail({ tenantId: context.tenantId, id: selectedId });
    }
  } catch (err) {
    logError("customers: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  /** Every link on the page keeps the search, segment and page it was clicked from. */
  function hrefWith(selected?: string, pageNo = result.page): string {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (customerType) p.set("customerType", customerType);
    if (status) p.set("status", status);
    if (cohort) p.set("cohort", cohort);
    if (pageNo > 1) p.set("page", String(pageNo));
    if (selected) p.set("selected", selected);
    const qs = p.toString();
    return qs ? `/customers?${qs}` : "/customers";
  }

  const pct = (n: number) => (summary.total > 0 ? Math.round((n / summary.total) * 1000) / 10 : 0);
  const avgOrderMinor = summary.attributedBills > 0 ? Math.round(summary.attributedSalesMinor / summary.attributedBills) : null;
  const first = result.total === 0 ? 0 : (result.page - 1) * CUSTOMER_PAGE_SIZE + 1;
  const last = Math.min(result.page * CUSTOMER_PAGE_SIZE, result.total);
  const growthMax = Math.max(1, ...analytics.growth.map((g) => g.count));
  const topMax = Math.max(1, ...analytics.topBySpend.map((t) => t.spentMinor));
  const segTotal = analytics.segments.reduce((a, s) => a + s.count, 0);
  const arcs = analytics.segments.reduce<{ type: CustomerType; pct: number; offset: number; count: number }[]>((acc, seg) => {
    const prev = acc[acc.length - 1];
    const share = segTotal ? (seg.count / segTotal) * 100 : 0;
    acc.push({ type: seg.type, count: seg.count, pct: share, offset: prev ? prev.offset - prev.pct : 25 });
    return acc;
  }, []);

  return (
    <div className="w-full min-w-0 p-4 sm:p-5">
      {/* ------------------------------------------------------------ header */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-primary">Customers (CRM)</h1>
          <p className="mt-0.5 text-[15px] text-tertiary">Build lasting relationships with your customers</p>
        </div>
        <CustomerActions variant="crm" />
      </header>

      {/* -------------------------------------------------------------- KPIs */}
      <section aria-label="Customer base" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          index={0}
          tone="sky"
          icon={<Users className="h-6 w-6" />}
          label="Total Customers"
          value={summary.total.toLocaleString("en-IN")}
          hint={<span className="text-success">+{summary.newThisMonth.toLocaleString("en-IN")} this month</span>}
        />
        <Kpi index={1} tone="violet" icon={<UserCheck className="h-6 w-6" />} label="Active Customers" value={summary.active.toLocaleString("en-IN")} hint={`${pct(summary.active)}% of total`} />
        <Kpi index={2} tone="emerald" icon={<Repeat2 className="h-6 w-6" />} label="Repeat Customers" value={summary.repeat.toLocaleString("en-IN")} hint={`${pct(summary.repeat)}% of total`} />
        <Kpi
          index={3}
          tone="teal"
          icon={<IndianRupee className="h-6 w-6" />}
          label="Sales from Customers"
          value={formatMinor(summary.attributedSalesMinor).replace(/\.00$/, "")}
          hint="Bills with a customer attached"
        />
        <Kpi
          index={4}
          tone="amber"
          icon={<Star className="h-6 w-6" />}
          label="Avg. Order Value"
          value={avgOrderMinor !== null ? formatMinor(avgOrderMinor).replace(/\.00$/, "") : "—"}
          hint={`${summary.attributedBills.toLocaleString("en-IN")} named bills`}
        />
      </section>

      {/* ------------------------------------------------------- views + filters */}
      <div className="mb-3 border-b border-border">
        <CustomerToolbar initialQuery={query} initialType={customerType} status={status} cohort={cohort} total={result.total} />
      </div>

      {/* --------------------------------------------------------- directory */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-labelledby="customer-toolbar-title"
          className={`cust-rise flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background-card shadow-sm ${
            /* With a customer open, the panel sets the row height and the table fills exactly
               that box, scrolling inside it — so both cards are always the same height. */
            detail ? "xl:h-0 xl:min-h-full" : ""
          }`}
          style={{ ["--i" as string]: 5 }}
        >
          {result.rows.length === 0 ? (
            query || customerType ? (
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title={query ? `No customers match “${query}”` : "No customers in this segment"}
                description="Try a name, phone number or email address, or clear the filters."
                action={
                  <Link href="/customers" className={buttonClass("secondary")}>
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Users className="h-5 w-5" />} title="No customers yet" description="Add one here, or attach a customer to a sale at the till." />
            )
          ) : (
            <>
              {/* Table from md up: fixed columns, never wider than its box; rows scroll inside. */}
              <div className="hidden min-h-0 flex-1 flex-col px-3 pt-3 md:flex">
                <div
                  className={`max-h-[max(320px,min(440px,calc(100dvh-400px)))] overflow-y-auto overflow-x-hidden overscroll-contain ${
                    detail ? "xl:max-h-none xl:min-h-0 xl:flex-1" : ""
                  }`}
                >
                  <table className="w-full table-fixed text-[11px]">
                    <caption className="sr-only">Customers</caption>
                    <thead>
                      <tr className="text-left text-[11px] font-semibold text-secondary">
                        <th scope="col" className="sticky top-0 z-10 w-9 rounded-l-md bg-background-subtle px-3 py-2.5">#</th>
                        <th scope="col" className="sticky top-0 z-10 bg-background-subtle px-2 py-2.5">Customer</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-[118px] bg-background-subtle px-2 py-2.5 lg:table-cell">Phone</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-[150px] bg-background-subtle px-2 py-2.5 min-[1700px]:table-cell">Email</th>
                        <th scope="col" className="sticky top-0 z-10 w-[86px] bg-background-subtle px-2 py-2.5">Segment</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-[72px] bg-background-subtle px-2 py-2.5 text-center lg:table-cell">Purchases</th>
                        <th scope="col" className="sticky top-0 z-10 w-[88px] bg-background-subtle px-2 py-2.5 text-right">Total Spend</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-[92px] bg-background-subtle px-2 py-2.5 lg:table-cell">Last Purchase</th>
                        <th scope="col" className="sticky top-0 z-10 w-[70px] bg-background-subtle px-2 py-2.5">Status</th>
                        <th scope="col" className="sticky top-0 z-10 w-[52px] rounded-r-md bg-background-subtle px-2 py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((customer, i) => {
                        const isSelected = selectedId === customer.id;
                        return (
                          <tr
                            key={customer.id}
                            aria-current={isSelected ? "true" : undefined}
                            className={`cust-row cust-rise border-b border-border ${isSelected ? "bg-primary-subtle/70" : "hover:bg-background-subtle"}`}
                            style={{ ["--i" as string]: i }}
                          >
                            <td className="px-3 py-2 text-secondary">{first + i}</td>
                            <td className="px-2 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <CustomerAvatar id={customer.id} name={customer.name} size="xs" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-primary">{customer.name}</p>
                                  <span className={`inline-block rounded px-1.5 py-0.2 text-[9px] font-bold border ${spendTier(customer.totalSpentMinor).className}`}>
                                    {spendTier(customer.totalSpentMinor).label}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="hidden truncate px-2 py-2 lg:table-cell">
                              <CustomerPhoneCell phone={customer.phone} canViewUnmasked={isOwnerOrManager} />
                            </td>
                            <td className="hidden truncate px-2 py-2 text-secondary min-[1700px]:table-cell">{customer.email ?? "—"}</td>
                            <td className="px-2 py-2">
                              <SegmentPill segment={customer.customerType} />
                            </td>
                            <td className="hidden px-2 py-2 text-center tabular-nums text-secondary lg:table-cell">{customer.purchaseCount}</td>
                            <td className="truncate px-2 py-2 text-right font-medium tabular-nums text-primary">{formatMinor(customer.totalSpentMinor).replace(/\.00$/, "")}</td>
                            <td className="hidden truncate px-2 py-2 text-secondary lg:table-cell">
                              {customer.lastPurchaseAt ? (
                                <time dateTime={customer.lastPurchaseAt.toISOString()} title={formatDateTime(customer.lastPurchaseAt)}>
                                  {formatDateOnly(customer.lastPurchaseAt)}
                                </time>
                              ) : (
                                <span className="text-tertiary">Never</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <span
                                className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${customer.isActive ? "border-emerald-200 bg-success-subtle text-success" : "border-danger-subtle bg-danger-subtle text-danger"}`}
                              >
                                {customer.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-2 py-2">
                              <Link
                                href={hrefWith(customer.id)}
                                scroll={false}
                                className="rounded px-1 text-[11px] font-medium text-primary-active hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
                                aria-label={`View details for ${customer.name}`}
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cards below md: the same facts, one tap target per customer. */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {result.rows.map((customer, i) => (
                  <li key={customer.id} className="cust-rise" style={{ ["--i" as string]: i }}>
                    <Link
                      href={hrefWith(customer.id)}
                      scroll={false}
                      aria-label={`View details for ${customer.name}`}
                      className={`cust-row-link flex items-center gap-3 px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${selectedId === customer.id ? "bg-primary-subtle/70" : "active:bg-background-subtle"}`}
                    >
                      <CustomerAvatar id={customer.id} name={customer.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium text-primary">{customer.name}</p>
                          <p className="shrink-0 text-[11px] font-semibold tabular-nums text-primary">{formatMinor(customer.totalSpentMinor)}</p>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-secondary">
                          <span className="flex min-w-0 items-center gap-2">
                            <SegmentPill segment={customer.customerType} />
                            <span className="truncate tabular-nums">{customer.phone ?? "No phone"}</span>
                          </span>
                          <span className="shrink-0">
                            {customer.purchaseCount} {customer.purchaseCount === 1 ? "purchase" : "purchases"}
                          </span>
                        </div>
                      </div>
                      <ChevronRight aria-hidden="true" className="cust-chevron h-4 w-4 shrink-0 text-tertiary" />
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-[11px] text-secondary">
                  Showing {first}–{last} of {result.total.toLocaleString("en-IN")} customers
                </p>
                <div className="flex items-center gap-3">
                  {result.pageCount > 1 && (
                    <nav aria-label="Pagination" className="flex items-center gap-1">
                      {result.page > 1 ? (
                        <Link href={hrefWith(undefined, result.page - 1)} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-primary-active hover:bg-background-subtle">
                          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                        </Link>
                      ) : (
                        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-slate-300">
                          <ChevronLeft className="h-4 w-4" />
                        </span>
                      )}
                      {pageWindow(result.page, result.pageCount).map((n, idx) =>
                        n === "gap" ? (
                          <span key={`g${idx}`} className="w-6 text-center text-[11px] text-tertiary">
                            …
                          </span>
                        ) : (
                          <Link
                            key={n}
                            href={hrefWith(undefined, n)}
                            aria-current={n === result.page ? "page" : undefined}
                            aria-label={`Page ${n}`}
                            className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[11px] font-medium tabular-nums ${n === result.page ? "bg-primary text-background-card" : "text-secondary hover:bg-background-hover"}`}
                          >
                            {n}
                          </Link>
                        ),
                      )}
                      {result.page < result.pageCount ? (
                        <Link href={hrefWith(undefined, result.page + 1)} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-primary-active hover:bg-background-subtle">
                          <ChevronRight aria-hidden="true" className="h-4 w-4" />
                        </Link>
                      ) : (
                        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-slate-300">
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      )}
                    </nav>
                  )}
                  <select disabled aria-label="Rows per page (fixed)" title={`Page size is fixed at ${CUSTOMER_PAGE_SIZE}`} className="h-8 cursor-not-allowed rounded-md border border-border bg-background-card px-2 text-[11px] text-tertiary">
                    <option>{CUSTOMER_PAGE_SIZE} / page</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </section>

        {detail ? (
          <CustomerDetailPanel key={detail.id} detail={detail} closeHref={hrefWith()} isOwnerOrManager={isOwnerOrManager} />
        ) : (
          <aside
            aria-label="Customer details"
            className="cust-rise hidden min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-card/60 p-8 text-center xl:flex"
            style={{ ["--i" as string]: 6 }}
          >
            <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
              <Users className="h-6 w-6" />
            </span>
            <p className="mt-4 text-[13px] font-semibold text-primary">Customer Details</p>
            <p className="mt-1 max-w-[240px] text-[13px] text-secondary">
              Choose <span className="font-medium">View</span> on any row to see their history and contact details.
            </p>
          </aside>
        )}
      </div>

      {/* ---------------------------------------------------------- analytics */}
      <section aria-label="Customer analytics" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.95fr)_minmax(0,1.3fr)]">
        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm md:col-span-2 xl:col-span-1 xl:h-[208px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-bold text-primary">Customer Growth</h2>
            <span className="rounded-md border border-border px-2.5 py-1 text-[11px] text-secondary">Last 6 Months</span>
          </div>
          <div className="mt-3 flex h-[128px] gap-2">
            <div className="flex w-6 shrink-0 flex-col justify-between pb-4 text-right text-[10px] text-tertiary" aria-hidden="true">
              <span>{growthMax}</span>
              <span>{Math.round(growthMax / 2)}</span>
              <span>0</span>
            </div>
            <div
              className="flex min-w-0 flex-1 items-end gap-3 border-b border-border"
              role="img"
              aria-label={`New customers by month: ${analytics.growth.map((g) => `${g.label} ${g.count}`).join(", ")}`}
            >
              {analytics.growth.map((g, i) => (
                <div key={g.label} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <div
                    className="sales-bar w-full max-w-[24px] rounded-t bg-gradient-to-t from-sky-500 to-sky-300"
                    style={{ height: `${Math.max((g.count / growthMax) * 100, g.count > 0 ? 4 : 1)}%`, ["--i" as string]: i }}
                    title={`${g.label}: ${g.count} new`}
                  />
                  <span className="absolute -bottom-4 text-[10px] text-tertiary">{g.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm xl:h-[208px]" style={{ ["--i" as string]: 1 }}>
          <h2 className="text-[16px] font-bold text-primary">Top Customers by Spend</h2>
          {analytics.topBySpend.length === 0 ? (
            <p className="mt-10 text-center text-[13px] text-tertiary">No named-customer sales yet</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-[11px]">
              {analytics.topBySpend.map((t) => (
                <li key={t.id} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-2">
                  <CustomerAvatar id={t.id} name={t.name} size="xs" />
                  <Link href={`/customers?selected=${t.id}`} className="truncate text-primary hover:text-primary-active hover:underline">
                    {t.name}
                  </Link>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="sales-meter block h-full rounded-full bg-primary-subtle0" style={{ width: `${Math.max((t.spentMinor / topMax) * 100, 4)}%` }} />
                  </span>
                  <span className="text-right font-medium tabular-nums text-primary">{formatMinor(t.spentMinor).replace(/\.00$/, "")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm xl:h-[208px]" style={{ ["--i" as string]: 2 }}>
          <h2 className="text-[16px] font-bold text-primary">Customer Segments</h2>
          <div className="mt-2 flex items-center gap-5">
            <div className="relative size-[132px] shrink-0">
              <svg viewBox="0 0 42 42" className="inv-donut size-full" role="img" aria-label={`Customers by segment: ${arcs.map((a) => `${SEGMENT_LABEL[a.type]} ${a.count}`).join(", ")}`}>
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                {arcs.map((a) => (
                  <circle key={a.type} cx="21" cy="21" r="15.915" fill="none" stroke={SEGMENT_COLOURS[a.type]} strokeWidth="6" strokeDasharray={`${a.pct} ${100 - a.pct}`} strokeDashoffset={a.offset} />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <strong className="text-[17px] font-bold tabular-nums text-primary">{segTotal.toLocaleString("en-IN")}</strong>
                <span className="text-[11px] text-tertiary">Customers</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-3 text-[11px]">
              {arcs.map((a) => (
                <li key={a.type} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: SEGMENT_COLOURS[a.type] }} />
                  <span className="w-20 truncate text-secondary">{SEGMENT_LABEL[a.type]}</span>
                  <span className="font-semibold tabular-nums text-primary">{a.count.toLocaleString("en-IN")}</span>
                  <span className="text-tertiary">({Math.round(a.pct * 10) / 10}%)</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

