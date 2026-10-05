import Link from "next/link";
import { Users, Banknote, UserCheck, Star, Receipt } from "lucide-react";
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
import { CustomerActions, CustomerToolbar } from "./CustomerClient";
import { CustomerDetailPanel } from "./CustomerDetailPanel";
import type { CustomerType } from "@prisma/client";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; selected?: string; customerType?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const selectedId = sp.selected;
  const customerType = (sp.customerType as CustomerType) || "";

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
      listCustomers({ tenantId: context.tenantId, query, customerType: customerType || undefined, page }),
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
        <PageHeader title="Customer Due & Khata" subtitle="Track outstanding dues, manage khata and follow up with customers" />
        <CustomerActions />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-6">
        <KpiCard label="Total Customers" value={String(summary.total)} tone="blue" icon={<Users className="h-5 w-5" />} />
        <KpiCard
          label="Attributed Sales"
          value={formatMinor(summary.attributedSalesMinor)}
          hint="Sales linked to customers"
          tone="amber"
          icon={<Banknote className="h-5 w-5" />}
        />
        <KpiCard label="Active Customers" value={String(summary.active)} hint="Not archived" tone="violet" icon={<UserCheck className="h-5 w-5" />} />
        <KpiCard
          label="Repeat Customers"
          value={String(summary.repeat)}
          hint=">1 purchase"
          tone="emerald"
          icon={<Star className="h-5 w-5" />}
        />
        <KpiCard
          label="Outstanding Dues"
          value="--"
          hint="ERP receivables not connected"
          icon={<Receipt className="h-5 w-5" />}
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
            <CustomerToolbar initialQuery={query} initialType={customerType} />

            {result.rows.length === 0 ? (
              query ? (
                <EmptyState
                  title={`No customers match “${query}”`}
                  description="Try a name, phone number or email address."
                  action={
                    <Link href={`/customers${customerType ? `?customerType=${customerType}` : ""}`} className={buttonClass("secondary")}>
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
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      <Th>Customer</Th>
                      <Th>Phone</Th>
                      <Th align="right">Purchases</Th>
                      <Th align="right">Total spend</Th>
                      <Th>Last purchase</Th>
                      <Th>Status</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rows.map((customer) => {
                      const isSelected = selectedId === customer.id;
                      
                      // Deterministic avatar colors
                      const colors = [
                        "bg-blue-100 text-blue-700",
                        "bg-emerald-100 text-emerald-700",
                        "bg-amber-100 text-amber-700",
                        "bg-rose-100 text-rose-700",
                        "bg-indigo-100 text-indigo-700",
                      ];
                      const colorIndex = customer.name.length % colors.length;
                      const avatarClass = colors[colorIndex];
                      
                      return (
                        <tr key={customer.id} className={`transition-colors ${isSelected ? "bg-blue-50/50" : "hover:bg-slate-50/80"}`}>
                          <Td>
                            <span className="flex items-center gap-3">
                              {/* Avoid img for now to match CRM truth, use soft initials */}
                              <span
                                aria-hidden="true"
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClass}`}
                              >
                                {customer.name.slice(0, 2).toUpperCase()}
                              </span>
                              <span className="flex flex-col items-start gap-0.5">
                                <span className="font-medium text-slate-900 leading-tight">{customer.name}</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
                                  customer.customerType === "RETAIL" ? "bg-blue-50 text-blue-600" :
                                  customer.customerType === "WHOLESALE" ? "bg-purple-50 text-purple-600" :
                                  "bg-emerald-50 text-emerald-600"
                                }`}>
                                  {customer.customerType.toLowerCase()}
                                </span>
                              </span>
                            </span>
                          </Td>
                          <Td className="whitespace-nowrap text-slate-500">{customer.phone ?? "—"}</Td>
                          <Td align="right" className="text-slate-600">{customer.purchaseCount}</Td>
                          <Td align="right" className="font-semibold text-slate-900">
                            {formatMinor(customer.totalSpentMinor)}
                          </Td>
                          <Td className="whitespace-nowrap text-slate-500">
                            {customer.lastPurchaseAt ? formatDateTime(customer.lastPurchaseAt) : "Never"}
                          </Td>
                          <Td>
                            {customer.isActive ? (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Active</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/20">Archived</span>
                            )}
                          </Td>
                          <Td align="right">
                            <Link 
                              href={`/customers?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ""}${customerType ? `&customerType=${customerType}` : ""}&selected=${customer.id}`}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              aria-label={`View details for ${customer.name}`}
                            >
                              View
                            </Link>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>

                <div className="bg-white rounded-b-xl">
                  <Pagination
                    basePath="/customers"
                    page={result.page}
                    pageCount={result.pageCount}
                    total={result.total}
                    pageSize={CUSTOMER_PAGE_SIZE}
                    params={{ q: query || undefined, customerType: customerType || undefined }}
                  />
                </div>
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
