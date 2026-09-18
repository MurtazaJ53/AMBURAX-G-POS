import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { listStoreStockMovements } from "@/server/inventory/inventoryQueries";
import { PageHeader, Card, StatusBadge, BadgeTone, buttonClass } from "../../_components/ui";
import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";

export default async function InventoryMovementsPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  
  const tenantId = resolved.context.tenantId;
  const storeId = resolved.context.storeId;

  const search = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const type = typeof searchParams.type === "string" ? searchParams.type : undefined;

  const { items, total } = await listStoreStockMovements({ tenantId, storeId, search, type, limit: 100, offset: 0 });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href="/inventory" className="text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Inventory
        </Link>
      </div>

      <PageHeader
        title="Movement History"
        subtitle="A complete audit trail of all stock changes in this store."
      />
      
      <Card className="mt-6">
        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <form className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search products or SKU..."
              className="block w-full rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
            />
            <select
              name="type"
              defaultValue={type}
              className="block rounded-md border-0 py-1.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
              
            >
              <option value="">All Types</option>
              <option value="RECEIPT">Receipt</option>
              <option value="SALE">Sale</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="STOCK_TAKE">Stock Take</option>
              <option value="OPENING_BALANCE">Opening Balance</option>
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 sm:pl-0 sm:pl-6">Date</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Product</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Type</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-slate-900">Delta</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-slate-900">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-slate-500 sm:pl-0 sm:pl-6">
                        {item.occurredAt.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-slate-900">
                        <div className="flex items-center">
                          {item.variant.product.imageUrl ? (
                            <img src={item.variant.product.imageUrl} alt="" className="h-6 w-6 rounded-md object-cover mr-2" />
                          ) : (
                            <div className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center mr-2">
                              <Package className="h-3 w-3 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <div>{item.variant.product.name}</div>
                            <div className="text-slate-500 font-normal text-xs">{item.variant.sku}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                        <StatusBadge tone={(item.type === "RECEIPT" ? "success" : item.type === "SALE" ? "info" : "neutral") as BadgeTone}>
                          {item.type}
                        </StatusBadge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-right font-medium">
                        <span className={item.quantityDelta > 0 ? "text-green-600" : item.quantityDelta < 0 ? "text-red-600" : "text-slate-500"}>
                          {item.quantityDelta > 0 ? "+" : ""}{item.quantityDelta}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-900 text-right font-medium">
                        {item.balanceAfter}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-slate-500">
                        No stock movements found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {total > 100 && (
          <div className="p-4 border-t border-slate-200 text-sm text-slate-500 text-center">
            Showing 100 of {total} records. Use filters to narrow down.
          </div>
        )}
      </Card>
    </div>
  );
}

