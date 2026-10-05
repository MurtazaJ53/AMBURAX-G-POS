import Link from "next/link";
import { Users, Receipt, FileText, MessageSquare, BookOpen, CreditCard, CalendarClock, PieChart, TrendingUp, Bell, FileSpreadsheet, Clock } from "lucide-react";
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

function CompactKpiCard({ label, value, hint, tone, icon }: { label: string, value: string, hint?: string, tone: string, icon: React.ReactNode }) {
  const toneClasses: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <Card className="p-4 flex items-center gap-4 h-[100px] shadow-sm border-slate-200">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneClasses[tone] || toneClasses.blue}`}>
        {icon}
      </div>
      <div className="flex flex-col justify-center overflow-hidden">
        <p className="text-[12px] font-medium text-slate-500 mb-0.5 truncate">{label}</p>
        <p className="text-[20px] font-bold text-slate-900 leading-tight mb-0.5 truncate">{value}</p>
        {hint && <p className="text-[11px] font-medium text-slate-400 truncate">{hint}</p>}
      </div>
    </Card>
  );
}

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
    <div className="px-4 py-6 sm:px-6 max-w-[1600px] mx-auto">
      <div className="mb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Customer Due & Khata</h1>
          <p className="text-sm text-slate-500 mt-1">Track outstanding dues, manage khata and follow up with customers</p>
        </div>
        <CustomerActions />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-5">
        <CompactKpiCard label="Total Customers" value={String(summary.total)} hint="Active records" tone="blue" icon={<Users className="h-5 w-5" />} />
        <CompactKpiCard label="Total Due Amount" value="--" hint="ERP not connected" tone="emerald" icon={<Receipt className="h-5 w-5" />} />
        <CompactKpiCard label="Active Khata" value="--" hint="ERP not connected" tone="blue" icon={<FileSpreadsheet className="h-5 w-5" />} />
        <CompactKpiCard label="Overdue Customers" value="--" hint="ERP not connected" tone="rose" icon={<Clock className="h-5 w-5" />} />
        <CompactKpiCard label="Avg. Days Pending" value="--" hint="ERP not connected" tone="violet" icon={<CalendarClock className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-4 mb-5">
        {/* Customer Due Overview (Pie Chart replacement) */}
        <Card className="flex flex-col col-span-1 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[200px]">
          <div className="border-b border-slate-100 p-3">
            <h2 className="text-[13px] font-bold text-slate-900">Customer Due Overview</h2>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <PieChart className="h-8 w-8 text-slate-200 mb-2" />
            <p className="text-[13px] font-medium text-slate-900">No Overview Data</p>
            <p className="text-[11px] text-slate-500 text-center mt-1">Connect ERP receivables to view due segments.</p>
          </div>
        </Card>
        
        {/* Due Amount Trend (Line Chart replacement) */}
        <Card className="flex flex-col col-span-1 lg:col-span-2 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[200px]">
          <div className="border-b border-slate-100 p-3 flex justify-between items-center">
            <h2 className="text-[13px] font-bold text-slate-900">Due Amount Trend</h2>
            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Last 6 Months</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <TrendingUp className="h-8 w-8 text-slate-200 mb-2" />
            <p className="text-[13px] font-medium text-slate-900">No Trend Data</p>
            <p className="text-[11px] text-slate-500 text-center mt-1">Authoritative trend data is managed in ERPNext.</p>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="flex flex-col col-span-1 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[200px]">
          <div className="border-b border-slate-100 p-3">
            <h2 className="text-[13px] font-bold text-slate-900">Quick Actions</h2>
          </div>
          <div className="flex-1 p-2 flex flex-col justify-between">
            <button className="flex items-center gap-3 p-1.5 rounded hover:bg-slate-50 transition-colors text-left group">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">View All Dues</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">See complete pending dues</div>
              </div>
            </button>
            <button className="flex items-center gap-3 p-1.5 rounded hover:bg-slate-50 transition-colors text-left group">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Send Due Reminder</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">WhatsApp / SMS / Call</div>
              </div>
            </button>
            <button className="flex items-center gap-3 p-1.5 rounded hover:bg-slate-50 transition-colors text-left group">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Create Khata</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">Open new khata for customer</div>
              </div>
            </button>
            <button className="flex items-center gap-3 p-1.5 rounded hover:bg-slate-50 transition-colors text-left group">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <CreditCard className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Collect Payment</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">Record customer payment</div>
              </div>
            </button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Card className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
        <div className={detail ? "" : "hidden xl:block"}>
          {detail ? (
            <CustomerDetailPanel detail={detail} />
          ) : (
            <Card className="flex h-full min-h-[200px] flex-col items-center justify-center p-6 text-center text-slate-500">
              <p className="text-sm">Select a customer to view details</p>
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 mb-8">
        {/* Recent Payments */}
        <Card className="flex flex-col border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[140px]">
          <div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50/50">
            <h2 className="text-[13px] font-bold text-slate-900">Recent Payments</h2>
            <Link href="#" className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">View All</Link>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-3">
            <Receipt className="h-6 w-6 text-slate-300 mb-1" />
            <p className="text-[12px] font-medium text-slate-900">No Payment Data</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Managed in ERPNext.</p>
          </div>
        </Card>

        {/* Top Due Customers */}
        <Card className="flex flex-col border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[140px]">
          <div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50/50">
            <h2 className="text-[13px] font-bold text-slate-900">Top Due Customers</h2>
            <Link href="#" className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">View All</Link>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-3">
            <Users className="h-6 w-6 text-slate-300 mb-1" />
            <p className="text-[12px] font-medium text-slate-900">No Due Data</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Managed in ERPNext.</p>
          </div>
        </Card>

        {/* Send Due Reminders (Blue Action Card) */}
        <Card className="flex flex-col border border-blue-100 shadow-sm rounded-xl overflow-hidden bg-blue-50 h-[140px]">
          <div className="p-4 flex-1 flex flex-row items-start gap-4">
            <div className="p-2.5 bg-white rounded-lg shadow-sm shrink-0 text-blue-600">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div className="flex flex-col items-start w-full">
              <h2 className="text-[13px] font-bold text-slate-900 mb-1">Send Due Reminders</h2>
              <p className="text-slate-500 text-[11px] mb-3 leading-snug">
                Remind customers about pending dues.
              </p>
              <button className="bg-blue-600 text-white hover:bg-blue-700 text-[11px] font-semibold py-1.5 px-4 rounded-md shadow-sm transition-colors mt-auto self-start">
                Send Reminders
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
