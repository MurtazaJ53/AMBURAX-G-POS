import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  listCustomers,
  getCustomerSummary,
  CUSTOMER_PAGE_SIZE,
  type CustomerPage,
  type CustomerSummary,
} from "@/server/sales/customers";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../sales/formatDateTime";
import {
  Card,
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  Td,
  Th,
  buttonClass,
} from "../_components/ui";

/**
 * Customers.
 *
 * Every figure per row — purchases, lifetime spend, last purchase — is aggregated from
 * committed sales, so they are facts rather than estimates.
 *
 * What the design reference shows and this does not: a VIP / Regular / New segment badge
 * and a loyalty tab. No segmentation or loyalty model exists, and a badge derived from a
 * spend threshold this product has never defined would be a fabricated metric dressed as a
 * customer relationship.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("customers: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");
  const context = resolved.context;

  let result: CustomerPage;
  let summary: CustomerSummary;
  try {
    [result, summary] = await Promise.all([
      listCustomers({ tenantId: context.tenantId, query, page }),
      getCustomerSummary({ tenantId: context.tenantId }),
    ]);
  } catch (err) {
    logError("customers: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader title="Customers" subtitle="People who shop with your business" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Customers" value={String(summary.total)} tone="blue" />
        <KpiCard label="Active" value={String(summary.active)} hint="Not archived" tone="violet" />
        {/* A real, countable definition: more than one completed sale. */}
        <KpiCard
          label="Repeat customers"
          value={String(summary.repeat)}
          hint="More than one purchase"
          tone="emerald"
        />
        <KpiCard
          label="Attributed sales"
          value={formatMinor(summary.attributedSalesMinor)}
          hint="Sales linked to a named customer"
          tone="amber"
        />
      </div>

      <Card className="mt-6">
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4"
        >
          <label htmlFor="customer-q" className="sr-only">
            Search customers by name, phone or email
          </label>
          <input
            id="customer-q"
            name="q"
            defaultValue={query}
            placeholder="Search by name, phone or email"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button type="submit" className={buttonClass("primary")}>
            Search
          </button>
          {query && (
            <Link href="/customers" className={buttonClass("secondary")}>
              Clear
            </Link>
          )}
        </form>

        {result.rows.length === 0 ? (
          query ? (
            <EmptyState
              title={`No customers match “${query}”`}
              description="Try a name, phone number or email address."
              action={
                <Link href="/customers" className={buttonClass("secondary")}>
                  Clear search
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No customers yet"
              description="Customers are added at the till when a sale is attributed to someone."
            />
          )
        ) : (
          <>
            <DataTable caption="Customers">
              <thead className="border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <Th>Customer</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th align="right">Purchases</Th>
                  <Th align="right">Total spend</Th>
                  <Th>Last purchase</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {result.rows.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500"
                        >
                          {customer.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="font-medium text-slate-900">{customer.name}</span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">{customer.phone ?? "—"}</Td>
                    <Td className="text-slate-600">{customer.email ?? "—"}</Td>
                    <Td align="right">{customer.purchaseCount}</Td>
                    <Td align="right" className="font-medium text-slate-900">
                      {formatMinor(customer.totalSpentMinor)}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500">
                      {/* Never bought is a different fact from bought long ago. */}
                      {customer.lastPurchaseAt ? formatDateTime(customer.lastPurchaseAt) : "Never"}
                    </Td>
                    <Td>
                      {customer.isActive ? (
                        <StatusBadge tone="success">Active</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Archived</StatusBadge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>

            <Pagination
              basePath="/customers"
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={CUSTOMER_PAGE_SIZE}
              params={{ q: query || undefined }}
            />
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Customers are created at the till during a sale. Customer profiles, segments, loyalty
        and dues arrive in Phase 5.
      </p>
    </div>
  );
}
