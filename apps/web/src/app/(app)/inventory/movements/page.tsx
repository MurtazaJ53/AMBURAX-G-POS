import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listStoreStockMovements } from "@/server/inventory/inventoryQueries";
import { Plus, ArrowDownToLine, ArrowUpFromLine, Package, ArrowDownRight, ArrowUpRight, RotateCcw } from "lucide-react";
import { MovementsToolbar } from "@/components/inventory/MovementsToolbar";

export default async function InventoryMovementsPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
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
  const type = typeof searchParams.type === "string" ? searchParams.type : undefined;
  
  const pageParam = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;
  const pageNumber = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = 50;
  const offset = (pageNumber - 1) * limit;

  const { items, total } = await listStoreStockMovements({ 
    tenantId, 
    storeId, 
    search, 
    type, 
    limit, 
    offset 
  });

  const pageCount = Math.ceil(total / limit);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5 bg-background text-foreground">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary">Inventory</h1>
          <p className="mt-1 text-sm text-secondary">
            Track your stock, variants and keep your store always ready
          </p>
        </div>
        <div className="hidden shrink-0 gap-2 md:flex">
          <button disabled className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold opacity-50">
            <ArrowUpFromLine className="h-4 w-4" /> Import
          </button>
          <button disabled className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold opacity-50">
            <ArrowDownToLine className="h-4 w-4" /> Export
          </button>
          {canManage && (
            <Link
              href="/inventory/receipts/new"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: "var(--color-primary)" }}
            >
              <Plus className="h-4 w-4" /> Receive Stock
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto border-b border-border">
        <div className="flex min-w-max">
          <Link href="/inventory" className="border-b-2 border-transparent px-4 py-3 text-xs font-medium text-secondary hover:text-primary transition-colors">
            Stock Overview
          </Link>
          <div className="border-b-2 border-primary px-4 py-3 text-xs font-medium text-primary">
            Movements History
          </div>
        </div>
      </div>

      <MovementsToolbar 
        search={search}
        type={type}
      />

      <div className="mt-4 min-w-0 overflow-hidden rounded-lg border border-border bg-background-card shadow-sm flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full min-w-[800px] border-collapse text-left text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-900 text-[10px] text-secondary sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="border-b border-border px-4 py-2 font-semibold w-40">Date</th>
                <th className="border-b border-border px-4 py-2 font-semibold">Product</th>
                <th className="border-b border-border px-4 py-2 font-semibold w-32">Type</th>
                <th className="border-b border-border px-4 py-2 font-semibold w-48">Reference</th>
                <th className="border-b border-border px-4 py-2 text-right font-semibold w-24">Delta</th>
                <th className="border-b border-border px-4 py-2 text-right font-semibold w-24">Balance</th>
              </tr>
            </thead>
            <tbody>
              {items.map(m => {
                const isAdd = m.quantityDelta > 0;
                const isSub = m.quantityDelta < 0;
                const color = m.type === "SALE" ? "text-red-500" : m.type === "RECEIPT" ? "text-green-500" : "text-blue-500";
                
                return (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-secondary">
                      {m.occurredAt.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-background-app flex items-center justify-center">
                          { }
                          {m.variant.product.imageUrl ? (
                            <img src={m.variant.product.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Package className="h-4 w-4 text-tertiary" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <b className="text-primary truncate block">{m.variant.product.name}</b>
                          <div className="flex items-center gap-1 text-[10px] text-secondary">
                            <span className="font-mono">{m.variant.sku}</span>
                            {(m.variant.size || m.variant.colour) && (
                              <>
                                <span>•</span>
                                <span>{[m.variant.size, m.variant.colour].filter(Boolean).join(" / ")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {m.type === "RECEIPT" ? <ArrowUpRight className={`h-3 w-3 ${color}`} /> : m.type === "SALE" ? <ArrowDownRight className={`h-3 w-3 ${color}`} /> : <RotateCcw className={`h-3 w-3 ${color}`} />}
                        <span className={`font-medium ${color}`}>{m.type === "OPENING_BALANCE" ? "OPENING" : m.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-secondary truncate">
                      {m.referenceType ? `${m.referenceType} ${m.referenceId || ""}` : (m.reason || "—")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={isAdd ? "text-green-600 font-bold" : isSub ? "text-red-600 font-bold" : "text-primary font-bold"}>
                        {isAdd ? "+" : ""}{m.quantityDelta}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      {m.balanceAfter}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-sm text-secondary">
                    No movements match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-slate-50 dark:bg-slate-900">
            <span className="text-[10px] text-secondary">
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} movements
            </span>
            <div className="flex gap-1">
              <Link
                href={pageNumber > 1 ? `/inventory/movements?page=${pageNumber - 1}${search ? `&q=${search}` : ""}${type ? `&type=${type}` : ""}` : "#"}
                className={`rounded border border-border px-2 py-1 text-[10px] ${pageNumber <= 1 ? "opacity-50 pointer-events-none" : "hover:bg-background-card"}`}
              >
                Previous
              </Link>
              <Link
                href={pageNumber < pageCount ? `/inventory/movements?page=${pageNumber + 1}${search ? `&q=${search}` : ""}${type ? `&type=${type}` : ""}` : "#"}
                className={`rounded border border-border px-2 py-1 text-[10px] ${pageNumber >= pageCount ? "opacity-50 pointer-events-none" : "hover:bg-background-card"}`}
              >
                Next
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
