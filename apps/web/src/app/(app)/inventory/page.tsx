import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { getInventoryOverview, listStockLevels } from "@/server/inventory/inventoryQueries";
import { PageHeader, Card, StatusBadge, BadgeTone, buttonClass } from "../_components/ui";
import Link from "next/link";
import { Package, AlertCircle, ArrowDownToLine, Archive } from "lucide-react";

function MetricCard({ title, value, subtitle, icon: Icon }: { title: string, value: string | number, subtitle?: string, icon: any }) {
  return (
    <Card className="p-6">
      <div className="flex items-center">
        <div className="rounded-md bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div className="ml-4">
          <h3 className="text-sm font-medium text-slate-500">{title}</h3>
          <div className="mt-1 flex items-baseline">
            <p className="text-2xl font-semibold text-slate-900">{value}</p>
          </div>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
    </Card>
  );
}

export default async function InventoryPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  
  const canManage = canManageInventory({
    tenantRole: resolved.context.tenantRole,
    membershipRole: resolved.context.membershipRole
  });

  const tenantId = resolved.context.tenantId;
  const storeId = resolved.context.storeId;

  const search = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const status = typeof searchParams.status === "string" ? searchParams.status : undefined;

  const [overview, { items, total }] = await Promise.all([
    getInventoryOverview({ tenantId, storeId }),
    listStockLevels({ tenantId, storeId, search, status, limit: 50, offset: 0 })
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Inventory"
        subtitle="Manage your stock levels, receive goods, and adjust inventory."
        actions={
          <div className="flex gap-2">
            <Link href="/inventory/movements" className={buttonClass("secondary")}>
              History
            </Link>
            {canManage && (
              <>
                <Link href="/inventory/adjustments/new" className={buttonClass("secondary")}>
                  Adjust
                </Link>
                <Link href="/inventory/receipts/new" className={buttonClass("primary")}>
                  Receive Stock
                </Link>
              </>
            )}
          </div>
        }
      />
      
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Variants" value={overview.totalItems} icon={Package} />
        <MetricCard title="In Stock" value={overview.inStock} icon={Archive} />
        <MetricCard title="Out of Stock" value={overview.outOfStock} icon={AlertCircle} />
        <MetricCard title="Recent Movements" subtitle="Last 7 days" value={overview.recentMovements} icon={ArrowDownToLine} />
      </div>

      <Card className="mt-8">
        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-base font-semibold leading-7 text-slate-900">Stock Levels</h2>
          
          <form className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search products or SKU..."
              className="block w-full rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
            />
            <select
              name="status"
              defaultValue={status}
              className="block rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
              
            >
              <option value="">All Status</option>
              <option value="in_stock">In Stock</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
            <button type="submit" className={buttonClass("secondary")}>Filter</button>
          </form>
        </div>

        <div className="flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <table className="min-w-full divide-y divide-slate-300">
                <thead>
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 sm:pl-0 sm:pl-6">Product</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">SKU</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-slate-900">Available</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Status</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-slate-900 sm:pl-0 sm:pl-6">
                        <div className="flex items-center">
                          {item.variant.product.imageUrl ? (
                            <img src={item.variant.product.imageUrl} alt="" className="h-8 w-8 rounded-md object-cover mr-3" />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center mr-3">
                              <Package className="h-4 w-4 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <div>{item.variant.product.name}</div>
                            <div className="text-slate-500 font-normal text-xs">{[item.variant.size, item.variant.colour].filter(Boolean).join(" / ")}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                        {item.variant.sku}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-900 text-right font-medium">
                        {item.quantity}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                        <StatusBadge tone={(item.quantity > 0 ? "success" : item.quantity < 0 ? "critical" : "neutral") as BadgeTone}>
                          {item.quantity > 0 ? "In Stock" : item.quantity < 0 ? "Negative" : "Out of Stock"}
                        </StatusBadge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                        {item.updatedAt.toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-slate-500">
                        No inventory records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {total > 50 && (
          <div className="p-4 border-t border-slate-200 text-sm text-slate-500 text-center">
            Showing 50 of {total} records. Use filters to find specific items.
          </div>
        )}
      </Card>
    </div>
  );
}

