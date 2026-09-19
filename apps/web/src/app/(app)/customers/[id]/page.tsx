import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, MapPin, Building2, User, Phone, Mail, ShoppingBag } from "lucide-react";
import { env } from "@/lib/env";

import { resolvePosContext } from "@/server/sales/posContext";
import { getCustomerDetail } from "@/server/sales/customers";
import { listCustomerAddresses } from "@/server/address/addressService";
import { db } from "@/server/db";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";
import { PageHeader, Card, StatusBadge, EmptyState, buttonClass, DataTable, Th, Td } from "@/app/(app)/_components/ui";

export default async function CustomerProfilePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");
  const auth = resolved.context;

  // Load customer detail, ensuring tenant isolation
  const customer = await getCustomerDetail({ tenantId: auth.tenantId, id: params.id });
  if (!customer) {
    notFound();
  }

  // Load addresses
  const addressResult = await listCustomerAddresses({ tenantId: auth.tenantId, customerId: customer.id });
  const addressLinks = addressResult.status === "ok" ? addressResult.addresses : [];
  
  // Load recent purchase history
  const recentSales = await db.sale.findMany({
    where: { tenantId: auth.tenantId, customerId: customer.id, status: "COMPLETED" },
    select: {
      id: true,
      billNumber: true,
      completedAt: true,
      totalMinor: true,
      store: { select: { name: true } }
    },
    orderBy: { completedAt: "desc" },
    take: 10
  });

  const initial = customer.name.slice(0, 2).toUpperCase();

  return (
    <div className="px-4 py-6 sm:px-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/customers"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            aria-label="Back to customers"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <PageHeader title={customer.name} subtitle={`Customer Profile • Joined ${formatDateTime(customer.createdAt)}`} />
        </div>
        <div>
          {customer.isActive ? (
            <StatusBadge tone="success">Active</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Archived</StatusBadge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        {/* Main Content (Left Column) */}
        <div className="space-y-6 min-w-0">
          
          {/* Contact & Commercial Info Card */}
          <Card className="p-6">
            <h2 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
              <User className="h-5 w-5 text-slate-400" />
              Contact & Identity
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Phone</span>
                <div className="flex items-center gap-2 text-slate-900">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {customer.phone || <span className="text-slate-400 italic">Not provided</span>}
                </div>
              </div>
              
              <div>
                <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Email</span>
                <div className="flex items-center gap-2 text-slate-900">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {customer.email || <span className="text-slate-400 italic">Not provided</span>}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">GSTIN</span>
                <div className="text-slate-900">
                  {customer.gstin ? (
                    <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded">{customer.gstin}</span>
                  ) : (
                    <span className="text-slate-400 italic">Not provided</span>
                  )}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Customer Type</span>
                <div>
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10">
                    {customer.customerType}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Addresses Card */}
          <Card className="flex flex-col">
            <div className="border-b border-slate-100 p-6 flex justify-between items-center">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-slate-400" />
                Addresses
              </h2>
            </div>
            
            <div className="p-6">
              {addressLinks.length === 0 ? (
                <EmptyState
                  title="No addresses on file"
                  description="Addresses are typically captured during deliveries or wholesale onboarding."
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {addressLinks.map((address) => (
                    <div key={address.id} className="rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors bg-slate-50/50">
                      <div className="flex justify-between items-start mb-3">
                        <StatusBadge tone={address.type === 'BILLING' ? 'info' : address.type === 'SHIPPING' ? 'success' : 'neutral'}>
                          {address.type}
                        </StatusBadge>
                        {!address.isActive && (
                          <StatusBadge tone="neutral">Inactive</StatusBadge>
                        )}
                      </div>
                      <address className="not-italic text-sm text-slate-700 space-y-1">
                        {address.contactName && <div className="font-medium text-slate-900">{address.contactName}</div>}
                        <div className="whitespace-pre-line">
                          {address.line1}
                          {address.line2 && <><br/>{address.line2}</>}
                        </div>
                        <div>{address.city}{address.postalCode && `, ${address.postalCode}`}</div>
                        {address.state && <div>{address.state}</div>}
                        <div>{address.country}</div>
                      </address>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Transaction History Card */}
          <Card className="flex flex-col">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-slate-400" />
                Recent Transactions
              </h2>
            </div>
            
            {recentSales.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No purchases yet"
                  description="Completed retail or wholesale bills will appear here."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable caption="Recent sales for customer">
                  <thead className="bg-slate-50/50">
                    <tr>
                      <Th>Bill Number</Th>
                      <Th>Store</Th>
                      <Th>Date</Th>
                      <Th align="right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentSales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
                        <Td className="font-medium text-blue-600">{sale.billNumber}</Td>
                        <Td className="text-slate-600">{sale.store.name}</Td>
                        <Td className="text-slate-500">{formatDateTime(sale.completedAt)}</Td>
                        <Td align="right" className="font-medium text-slate-900">{formatMinor(sale.totalMinor)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar (Right Column) */}
        <div className="space-y-6">
          
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Purchases</span>
              <span className="text-2xl font-black text-slate-900">{customer.purchaseCount}</span>
            </Card>
            <Card className="p-4 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Lifetime Spend</span>
              <span className="text-xl font-black text-slate-900">{formatMinor(customer.totalSpentMinor)}</span>
            </Card>
          </div>

          {/* Commercial Terms */}
          <Card className="flex flex-col">
            <div className="border-b border-slate-100 p-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-400" />
                Commercial Terms
              </h2>
            </div>
            <div className="p-4 text-sm text-slate-600">
              {customer.creditLimitMinor !== null || customer.paymentTermsDays !== null || customer.priceListId !== null ? (
                <dl className="space-y-3">
                  {customer.creditLimitMinor !== null && (
                    <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                      <dt className="text-slate-500">Credit Limit</dt>
                      <dd className="font-semibold text-slate-900">{formatMinor(customer.creditLimitMinor)}</dd>
                    </div>
                  )}
                  {customer.paymentTermsDays !== null && (
                    <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                      <dt className="text-slate-500">Payment Terms</dt>
                      <dd className="font-semibold text-slate-900">{customer.paymentTermsDays} days</dd>
                    </div>
                  )}
                  {customer.priceListId !== null && (
                    <div className="flex justify-between items-center">
                      <dt className="text-slate-500">Price List</dt>
                      <dd className="font-semibold text-slate-900">{customer.priceListId}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-center py-4">
                  <p>No special wholesale terms have been agreed with this customer.</p>
                </div>
              )}
            </div>
          </Card>

          {/* Khata & Dues Warning */}
          <Card className="flex flex-col border-amber-200">
            <div className="border-b border-amber-100 bg-amber-50/50 p-4">
              <h2 className="text-sm font-bold text-amber-900">Khata & Dues</h2>
            </div>
            <div className="p-4 bg-amber-50">
              <p className="text-sm text-amber-800 mb-2 font-medium">ERP receivables data not connected</p>
              <p className="text-xs text-amber-700/90 leading-relaxed">
                Outstanding balances, ledgers, and payment history are authoritative to ERPNext and are currently unavailable in this view. Please refer to your accounting system for financial standing.
              </p>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
