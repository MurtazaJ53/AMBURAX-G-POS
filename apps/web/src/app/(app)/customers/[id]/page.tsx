import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  IndianRupee,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  User,
} from "lucide-react";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { getCustomerDetail } from "@/server/sales/customers";
import { listCustomerAddresses } from "@/server/address/addressService";
import { db } from "@/server/db";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateOnly, formatDateTime, formatTime } from "@/app/(app)/sales/formatDateTime";
import { StatusBadge } from "@/app/(app)/_components/ui";
import { ActiveDot, CustomerAvatar, NotConnectedChip, SegmentPill, StatTile } from "../customerUi";

function SectionCard(props: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  index?: number;
  action?: React.ReactNode;
}) {
  const id = `section-${props.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="cust-rise overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      style={{ ["--i" as string]: props.index ?? 0 }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            {props.icon}
          </span>
          {props.title}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export default async function CustomerProfilePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");
  const auth = resolved.context;

  // Tenant-scoped: another tenant's id is a 404, not a leak.
  const customer = await getCustomerDetail({ tenantId: auth.tenantId, id: params.id });
  if (!customer) notFound();

  const addressResult = await listCustomerAddresses({ tenantId: auth.tenantId, customerId: customer.id });
  const addresses = addressResult.status === "ok" ? addressResult.addresses : [];

  const recentSales = await db.sale.findMany({
    where: { tenantId: auth.tenantId, customerId: customer.id, status: "COMPLETED" },
    select: { id: true, billNumber: true, completedAt: true, totalMinor: true, store: { select: { name: true } } },
    orderBy: { completedAt: "desc" },
    take: 10,
  });

  const avgOrderMinor = customer.purchaseCount > 0 ? Math.round(customer.totalSpentMinor / customer.purchaseCount) : null;
  const hasTerms =
    customer.creditLimitMinor !== null || customer.paymentTermsDays !== null || customer.priceListId !== null;

  const actionClass =
    "amb-press inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="cust-rise mb-4">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Customers
        </Link>
      </nav>

      {/* ------------------------------------------------------------- hero */}
      <header
        className="cust-rise relative mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--i" as string]: 1 }}
      >
        <div aria-hidden="true" className="relative h-20 overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 sm:h-24">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
          <div className="absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-end gap-4">
            <div className="-mt-8 rounded-full bg-white p-1 shadow-md sm:-mt-10">
              <CustomerAvatar id={customer.id} name={customer.name} size="lg" />
            </div>
            <div className="min-w-0 pb-0.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{customer.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <SegmentPill segment={customer.customerType} />
                <ActiveDot active={customer.isActive} />
                <span aria-hidden="true" className="text-slate-300">•</span>
                <span>Customer since {formatDateOnly(customer.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className={actionClass}>
                <Phone aria-hidden="true" className="h-4 w-4 text-slate-500" />
                Call
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className={actionClass}>
                <Mail aria-hidden="true" className="h-4 w-4 text-slate-500" />
                Email
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ figures */}
      <section aria-label="Customer figures" className="mb-6 grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <StatTile index={2} label="Purchases" value={customer.purchaseCount.toLocaleString("en-IN")} hint="Completed bills" tone="blue" icon={<ShoppingBag className="h-4 w-4" />} />
        <StatTile index={3} label="Lifetime spend" value={formatMinor(customer.totalSpentMinor)} hint="All completed bills" tone="emerald" icon={<IndianRupee className="h-4 w-4" />} />
        <StatTile
          index={4}
          label="Avg. order"
          value={avgOrderMinor !== null ? formatMinor(avgOrderMinor) : "—"}
          hint={avgOrderMinor !== null ? "Spend ÷ purchases" : "No purchases yet"}
          tone="violet"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatTile
          index={5}
          label="Last purchase"
          value={customer.lastPurchaseAt ? formatDateOnly(customer.lastPurchaseAt) : "Never"}
          hint={customer.lastPurchaseAt ? `at ${formatTime(customer.lastPurchaseAt)}` : "No completed bill"}
          tone="amber"
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ------------------------------------------------------------ main */}
        <div className="min-w-0 space-y-6">
          <SectionCard title="Recent transactions" icon={<ReceiptText className="h-4 w-4" />} index={6}>
            {recentSales.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <span aria-hidden="true" className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-900">No purchases yet</p>
                <p className="mt-1 text-sm text-slate-600">Completed retail or wholesale bills will appear here.</p>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[560px] text-sm">
                    <caption className="sr-only">Recent sales for this customer</caption>
                    <thead>
                      <tr className="bg-slate-50/80 text-left">
                        <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600">Bill</th>
                        <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Store</th>
                        <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Date</th>
                        <th scope="col" className="px-5 py-3 text-right text-xs font-semibold text-slate-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentSales.map((sale, i) => (
                        <tr key={sale.id} className="cust-row cust-rise hover:bg-slate-50" style={{ ["--i" as string]: i }}>
                          <td className="px-5 py-3 font-mono text-xs font-semibold text-blue-700">{sale.billNumber}</td>
                          <td className="px-4 py-3 text-slate-700">{sale.store.name}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {sale.completedAt ? <time dateTime={sale.completedAt.toISOString()}>{formatDateTime(sale.completedAt)}</time> : "—"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {formatMinor(sale.totalMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-slate-100 md:hidden">
                  {recentSales.map((sale, i) => (
                    <li key={sale.id} className="cust-rise flex items-center justify-between gap-3 px-5 py-3.5" style={{ ["--i" as string]: i }}>
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-blue-700">{sale.billNumber}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-600">
                          {sale.store.name} · {sale.completedAt ? formatDateTime(sale.completedAt) : "—"}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatMinor(sale.totalMinor)}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Addresses"
            icon={<MapPin className="h-4 w-4" />}
            index={7}
            action={
              addresses.length > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{addresses.length}</span>
              ) : undefined
            }
          >
            {addresses.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-900">No addresses on file</p>
                <p className="mt-1 text-sm text-slate-600">Addresses are captured during deliveries or wholesale onboarding.</p>
              </div>
            ) : (
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {addresses.map((address) => (
                  <div key={address.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition-colors hover:border-slate-300">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <StatusBadge tone={address.type === "BILLING" ? "info" : address.type === "SHIPPING" ? "success" : "neutral"}>
                        {address.type}
                      </StatusBadge>
                      {!address.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    </div>
                    <address className="space-y-0.5 text-sm not-italic text-slate-700">
                      {address.contactName && <div className="font-medium text-slate-900">{address.contactName}</div>}
                      <div>{address.line1}</div>
                      {address.line2 && <div>{address.line2}</div>}
                      <div>
                        {address.city}
                        {address.postalCode && `, ${address.postalCode}`}
                      </div>
                      {address.state && <div>{address.state}</div>}
                      <div>{address.country}</div>
                    </address>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* --------------------------------------------------------- sidebar */}
        <div className="space-y-6">
          <SectionCard title="Contact & identity" icon={<User className="h-4 w-4" />} index={8}>
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                { label: "Phone", value: customer.phone },
                { label: "Email", value: customer.email },
                { label: "GSTIN", value: customer.gstin },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="text-slate-600">{row.label}</dt>
                  <dd className={`min-w-0 truncate text-right font-medium tabular-nums ${row.value ? "text-slate-900" : "italic text-slate-500"}`}>
                    {row.value ?? "Not provided"}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-slate-600">Segment</dt>
                <dd>
                  <SegmentPill segment={customer.customerType} />
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Commercial terms" icon={<Building2 className="h-4 w-4" />} index={9}>
            {hasTerms ? (
              <dl className="divide-y divide-slate-100 text-sm">
                {customer.creditLimitMinor !== null && (
                  <div className="flex justify-between gap-4 px-5 py-3">
                    <dt className="text-slate-600">Credit limit</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(customer.creditLimitMinor)}</dd>
                  </div>
                )}
                {customer.paymentTermsDays !== null && (
                  <div className="flex justify-between gap-4 px-5 py-3">
                    <dt className="text-slate-600">Payment terms</dt>
                    <dd className="font-semibold text-slate-900">{customer.paymentTermsDays} days</dd>
                  </div>
                )}
                {customer.priceListId !== null && (
                  <div className="flex justify-between gap-4 px-5 py-3">
                    <dt className="text-slate-600">Price list</dt>
                    <dd className="truncate font-semibold text-slate-900">{customer.priceListId}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-600">No special terms have been agreed with this customer.</p>
            )}
          </SectionCard>

          <section
            aria-labelledby="profile-khata-heading"
            className="cust-rise relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            style={{ ["--i" as string]: 10 }}
          >
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="profile-khata-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  Khata &amp; dues
                </h2>
                <NotConnectedChip />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-800">Accounting sync not connected</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Outstanding balance, ledger entries and payment history are held by the accounting sync.
                They will appear here once receivables are connected — AMBURAX does not estimate them.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
