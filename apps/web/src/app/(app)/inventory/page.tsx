import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { getInventoryOverview, listStockLevels, listStoreStockMovements } from "@/server/inventory/inventoryQueries";
import { Package, Boxes, ShoppingBag, CircleHelp } from "lucide-react";

import { StatusPill, KpiCard } from "@/components/inventory/InventoryUI";
import { InventoryDetailPanel } from "@/components/inventory/InventoryDetailPanel";
import { InventoryToolbar } from "@/components/inventory/InventoryToolbar";
import { InventoryAnalytics } from "@/components/inventory/InventoryAnalytics";

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
  const category = typeof searchParams.category === "string" ? searchParams.category : undefined;
  const brand = typeof searchParams.brand === "string" ? searchParams.brand : undefined;
  const selectedSku = typeof searchParams.selected === "string" ? searchParams.selected : undefined;
  const view = (typeof searchParams.view === "string" ? searchParams.view : "table") as "table" | "grid";
  const limit = 50;

  const [overview, { items, total }, { items: movements }] = await Promise.all([
    getInventoryOverview({ tenantId, storeId }),
    listStockLevels({ tenantId, storeId, search, status, category, brand, limit, offset: 0 }),
    listStoreStockMovements({ tenantId, storeId, limit: 10, offset: 0 })
  ]);

  const selectedItem = selectedSku ? items.find((i) => i.variant.sku === selectedSku) : undefined;

  const createSelectHref = (sku: string | undefined) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (view !== "table") p.set("view", view);
    
    if (sku) p.set("selected", sku);
    return `/inventory?${p.toString()}`;
  };

  return (
    <div className="flex-1 p-6 flex flex-col min-w-0 min-h-0 overflow-hidden max-h-[calc(100vh-56px)]">
      <div className="flex-none flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-secondary mb-1">Workspace / Inventory</div>
          <h1 className="text-2xl font-bold text-primary">Inventory</h1>
          <p className="text-sm text-secondary mt-1">Track your stock, variants and keep your store always ready</p>
        </div>
        <div className="flex items-center gap-2">
          <button disabled className="hidden sm:inline-flex h-8 items-center justify-center rounded-[4px] border border-slate-300 bg-white px-3 text-[11px] font-semibold text-primary opacity-50 cursor-not-allowed shadow-sm">
            Import
          </button>
          <button disabled className="hidden sm:inline-flex h-8 items-center justify-center rounded-[4px] border border-slate-300 bg-white px-3 text-[11px] font-semibold text-primary opacity-50 cursor-not-allowed shadow-sm">
            Export
          </button>
          {canManage ? (
            <Link href="/products/new" className="inline-flex h-8 items-center justify-center rounded-[4px] bg-blue-600 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors">
              Add Product
            </Link>
          ) : (
            <button disabled className="inline-flex h-8 items-center justify-center rounded-[4px] bg-blue-600 px-3 text-[11px] font-semibold text-white opacity-50 cursor-not-allowed shadow-sm">
              Add Product
            </button>
          )}
        </div>
      </div>

      <div className="flex-none mt-6 border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <div className="border-b-2 border-primary px-3 py-2 text-[11px] font-semibold text-primary whitespace-nowrap">
            Stock Overview
          </div>
          <Link href="/products" className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-secondary hover:text-primary transition-colors whitespace-nowrap">
            Products
          </Link>
          <span className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed" title="Not available">
            Variants
          </span>
          <span className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed" title="Not available">
            Categories
          </span>
          <span className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed" title="Not available">
            Brands
          </span>
          <Link href="/inventory/adjustments/new" className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-secondary hover:text-primary transition-colors whitespace-nowrap">
            Stock Adjustments
          </Link>
          <Link href="/inventory/receipts/new" className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-secondary hover:text-primary transition-colors whitespace-nowrap">
            Stock Take
          </Link>
          <span className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed" title="Not available">
            Low Stock
          </span>
          <span className="border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed" title="Not available">
            Expiring / Aging
          </span>
        </div>
      </div>

      <div className="flex-none grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 mb-5">
        <KpiCard icon={Package} label="Total Products" value={String(overview.totalItems)} note="Across this store" />
        <KpiCard icon={Boxes} label="Total Stock (Units)" value={String(overview.totalUnits)} note="Current on-hand units" />
        <KpiCard icon={ShoppingBag} label="Stock Value" value="Not connected" note="Valuation unavailable" muted={true} />
        <KpiCard icon={CircleHelp} label="Low Stock Items" value={String(overview.lowStock)} note="Across this store" />
        <KpiCard icon={Package} label="Out of Stock" value={String(overview.outOfStock)} note="Across this store" />
      </div>

      <div className="flex-none">
        <InventoryToolbar 
          search={search}
          status={status}
          category={category}
          brand={brand}
          view={view}
        />
      </div>

      <div className={`flex-1 min-w-0 min-h-0 grid gap-4 mt-4 ${selectedItem ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1"}`}>
        {view === "table" ? (
          <div className="flex flex-col min-w-0 min-h-0 overflow-hidden rounded-[6px] border border-border bg-background-card shadow-sm">
            <div className="flex-1 overflow-x-auto overflow-y-auto relative bg-white">
              <table className="w-full min-w-[1000px] border-collapse text-left text-[12px]">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-secondary sticky top-0 z-10 shadow-[0_1px_0_0_var(--border)]">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Product</th>
                    <th className="px-4 py-2 font-semibold">SKU</th>
                    <th className="px-4 py-2 font-semibold">Category</th>
                    <th className="px-4 py-2 font-semibold">Brand</th>
                    <th className="px-4 py-2 font-semibold text-right">Variants</th>
                    <th className="px-4 py-2 text-right font-semibold">Stock &darr;</th>
                    <th className="px-4 py-2 text-right font-semibold">Reserved</th>
                    <th className="px-4 py-2 text-right font-semibold">Available</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map(p => {
                    const st = p.quantity > 10 ? "In Stock" : p.quantity > 0 ? "Low Stock" : p.quantity < 0 ? "Negative" : "Out of Stock";
                    return (
                      <tr 
                        key={p.variant.sku} 
                        className={`h-9 hover:bg-slate-50 transition-colors ${selectedSku === p.variant.sku ? "bg-slate-50" : ""}`}
                      >
                        <td className="px-4 py-1.5 min-w-0">
                          <Link href={createSelectHref(p.variant.sku)} className="flex items-center gap-2 group">
                            <div className="h-7 w-7 shrink-0 overflow-hidden rounded-[3px] bg-background-app flex items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {p.variant.product.imageUrl ? (
                                <img src={p.variant.product.imageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <Package className="h-3.5 w-3.5 text-tertiary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <b className="text-primary truncate block group-hover:underline">{p.variant.product.name}</b>
                              {p.variant.size || p.variant.colour ? (
                                <p className="text-[10px] text-secondary truncate">
                                  {[p.variant.size, p.variant.colour].filter(Boolean).join(" / ")}
                                </p>
                              ) : null}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-1.5 text-secondary font-mono text-[11px] truncate">{p.variant.sku}</td>
                        <td className="px-4 py-1.5 text-primary truncate">{p.variant.product.category || "—"}</td>
                        <td className="px-4 py-1.5 text-primary truncate">{p.variant.product.brand || "—"}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-[11px] text-tertiary">&mdash;</td>
                        <td className="px-4 py-1.5 text-right font-mono text-[13px] font-bold text-primary">{p.quantity}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-[11px] text-tertiary">&mdash;</td>
                        <td className="px-4 py-1.5 text-right font-mono text-[11px] text-tertiary">{p.quantity}</td>
                        <td className="px-4 py-1.5 w-[140px]"><StatusPill status={st} /></td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-sm text-secondary">
                        No products match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total > 0 && (
              <div className="flex-none items-center border-t border-border px-4 py-3 text-[10px] text-secondary bg-slate-50">
                <span>Showing 1&mdash;{items.length} of {total} products</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 content-start pr-1">
            {items.map(p => {
              const st = p.quantity > 10 ? "In Stock" : p.quantity > 0 ? "Low Stock" : p.quantity < 0 ? "Negative" : "Out of Stock";
              return (
                <Link 
                  key={p.variant.sku} 
                  href={createSelectHref(p.variant.sku)} 
                  className={`rounded-lg border bg-background-card p-3 text-left shadow-sm hover:border-primary transition-colors ${selectedSku === p.variant.sku ? "border-primary ring-1 ring-primary" : "border-border"}`}
                >
                  <div className="h-32 w-full rounded-md bg-background-app mb-3 flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.variant.product.imageUrl ? (
                      <img src={p.variant.product.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-8 w-8 text-tertiary" />
                    )}
                  </div>
                  <b className="block text-sm text-primary truncate">{p.variant.product.name}</b>
                  <span className="text-[11px] text-secondary truncate block font-mono">{p.variant.sku}</span>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[12px] font-bold text-primary font-mono">{p.quantity} <span className="font-sans font-medium text-[10px] text-secondary">units</span></span>
                    <StatusPill status={st} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {selectedItem && (
          <InventoryDetailPanel item={selectedItem} closeHref={createSelectHref(undefined)} canManage={canManage} />
        )}
      </div>

      <div className="flex-none">
        <InventoryAnalytics 
          totalUnits={overview.totalUnits}
          inStock={overview.inStock}
          lowStock={overview.lowStock}
          outOfStock={overview.outOfStock}
          stockByCategory={overview.stockByCategory}
          recentMovements={movements}
        />
      </div>
    </div>
  );
}
