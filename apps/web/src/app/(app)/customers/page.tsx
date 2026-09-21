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
  getCustomerDetail,
  CUSTOMER_PAGE_SIZE,
  type CustomerPage,
  type CustomerSummary,
  type CustomerDetail,
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
import { CustomerActions } from "./CustomerClient";
import { CustomerDetailPanel } from "./CustomerDetailPanel";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; selected?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const selectedId = sp.selected;

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

  let result: CustomerPage;
  let summary: CustomerSummary;
  let detail: CustomerDetail | null = null;
  try {
    [result, summary] = await Promise.all([
      listCustomers({ tenantId: context.tenantId, query, page }),
      getCustomerSummary({ tenantId: context.tenantId }),
    ]);
    if (selectedId) {
      detail = await getCustomerDetail({ tenantId: context.tenantId, id: selectedId });
    }
  } catch (err) {
    logError("customers: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <PageHeader title="Customer Due & Khata" subtitle="Track customers and view basic metrics" />
        <CustomerActions />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        <KpiCard label="Total Customers" value={String(summary.total)} tone="blue" />
        <KpiCard label="Active Customers" value={String(summary.active)} hint="Not archived" tone="violet" />
        <KpiCard
          label="Repeat Customers"
          value={String(summary.repeat)}
          hint=">1 purchase"
          tone="emerald"
        />
        <KpiCard
          label="Attributed Sales"
          value={formatMinor(summary.attributedSalesMinor)}
          hint="Sales linked to customers"
          tone="amber"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3 mb-6">
        <Card className="flex flex-col">
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-bold text-slate-900">Due Amount Trend</h2>
          </div>
          <div className="flex-1 p-6">
            <EmptyState
              title="ERP receivables data not connected"
              description="Authoritative trend data is managed in ERPNext."
            />
          </div>
        </Card>
        
        <Card className="flex flex-col">
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-bold text-slate-900">Recent Payments</h2>
          </div>
          <div className="flex-1 p-6">
            <EmptyState
              title="ERP receivables data not connected"
              description="Payment ledgers and recent receipts are managed in ERPNext."
            />
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-bold text-slate-900">Top Due Customers</h2>
          </div>
          <div className="flex-1 p-6">
            <EmptyState
              title="ERP receivables data not connected"
              description="Receivables and outstanding balances are managed in ERPNext."
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Card>
            <form
              method="get"
              className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4"
            >
              <label htmlFor="customer-q" className="sr-only">
                Search customers
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
                      <Th align="right">Purchases</Th>
                      <Th align="right">Total spend</Th>
                      <Th>Last purchase</Th>
                      <Th>Status</Th>
                      <Th>Action</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {result.rows.map((customer) => {
                      const isSelected = selectedId === customer.id;
                      return (
                        <tr key={customer.id} className={isSelected ? "bg-blue-50/50" : "hover:bg-slate-50"}>
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
                          <Td align="right">{customer.purchaseCount}</Td>
                          <Td align="right" className="font-medium text-slate-900">
                            {formatMinor(customer.totalSpentMinor)}
                          </Td>
                          <Td className="whitespace-nowrap text-slate-500">
                            {customer.lastPurchaseAt ? formatDateTime(customer.lastPurchaseAt) : "Never"}
                          </Td>
                          <Td>
                            {customer.isActive ? (
                              <StatusBadge tone="success">Active</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">Archived</StatusBadge>
                            )}
                          </Td>
                          <Td>
                            <Link 
                              href={`/customers?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ""}&selected=${customer.id}`}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              View
                            </Link>
                          </Td>
                        </tr>
                      );
                    })}
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
        </div>

        {/* Aside Panel */}
        <div className="w-full">
          {detail ? (
            <CustomerDetailPanel detail={detail} />
          ) : (
            <Card className="flex h-full min-h-[300px] flex-col items-center justify-center p-6 text-center text-slate-500">
              <p className="text-sm">Select a customer to view details</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
