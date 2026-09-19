import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { getInventoryOverview, listStockLevels, listStoreStockMovements } from "@/server/inventory/inventoryQueries";
import { Plus, ArrowDownToLine, ArrowUpFromLine, UserRound, Box, ShoppingCart, TriangleAlert, PackageOpen, SlidersHorizontal, Search, Grid2X2, Boxes, MoreHorizontal, ChevronLeft, ChevronRight, ChevronDown, Package } from "lucide-react";

import { StatusPill, Metric } from "@/components/inventory/InventoryUI";
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

  const createFilterHref = (key: string, value: string) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (view !== "table") p.set("view", view);
    
    if (value === "") p.delete(key);
    else p.set(key, value);
    
    return `/inventory?${p.toString()}`;
  };

  const createSelectHref = (sku?: string) => {
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
          <div className="border-b-2 border-primary px-4 py-3 text-xs font-medium text-primary">
            Stock Overview
          </div>
          <Link href="/inventory/movements" className="border-b-2 border-transparent px-4 py-3 text-xs font-medium text-secondary hover:text-primary transition-colors">
            Movements History
          </Link>
        </div>
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        <Metric icon={Box} label="Total Variants" value={String(overview.totalItems)} tone="bg-blue-100 text-blue-700" />
        <Metric icon={ShoppingCart} label="Total Units" value={String(overview.totalUnits)} tone="bg-emerald-100 text-emerald-700" />
        <Metric icon={TriangleAlert} label="Low Stock Variants" value={String(overview.lowStock)} tone="bg-amber-100 text-amber-700" />
        <Metric icon={PackageOpen} label="Out of Stock" value={String(overview.outOfStock)} tone="bg-red-100 text-red-700" />
      </div>

      <InventoryToolbar 
        search={search}
        status={status}
        category={category}
        brand={brand}
        view={view}
      />

      <div className="mt-4 flex justify-end">
        <div className="inline-flex rounded-md border border-border bg-background-card p-1">
          <Link href={createFilterHref("view", "table")} className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium ${view === "table" ? "bg-primary text-white" : "text-secondary hover:text-primary"}`}>
            <Grid2X2 className="h-4 w-4" /> Table
          </Link>
          <Link href={createFilterHref("view", "grid")} className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium ${view === "grid" ? "bg-primary text-white" : "text-secondary hover:text-primary"}`}>
            <Boxes className="h-4 w-4" /> Grid
          </Link>
        </div>
      </div>

      <div className={`mt-4 grid min-w-0 gap-4 ${selectedItem ? "xl:grid-cols-[minmax(0,1fr)_310px]" : "grid-cols-1"}`}>
        {view === "table" ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-background-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-left text-[11px]">
                <thead className="bg-slate-50 dark:bg-slate-900 text-[10px] text-secondary">
                  <tr>
                    <th className="border-b border-border px-4 py-2 font-semibold">Product</th>
                    <th className="border-b border-border px-4 py-2 font-semibold">SKU</th>
                    <th className="border-b border-border px-4 py-2 font-semibold">Category</th>
                    <th className="border-b border-border px-4 py-2 font-semibold">Brand</th>
                    <th className="border-b border-border px-4 py-2 text-right font-semibold">Stock &darr;</th>
                    <th className="border-b border-border px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(p => {
                    const st = p.quantity > 10 ? "In Stock" : p.quantity > 0 ? "Low Stock" : p.quantity < 0 ? "Negative" : "Out of Stock";
                    return (
                      <tr 
                        key={p.variant.sku} 
                        className={`border-b border-border last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selectedSku === p.variant.sku ? "bg-slate-50 dark:bg-slate-800/50" : ""}`}
                      >
                        <td className="px-4 py-2">
                          <Link href={createSelectHref(p.variant.sku)} className="flex items-center gap-2 group block">
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-background-app flex items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {p.variant.product.imageUrl ? (
                                <img src={p.variant.product.imageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <Package className="h-4 w-4 text-tertiary" />
                              )}
                            </div>
                            <div>
                              <b className="text-primary group-hover:underline">{p.variant.product.name}</b>
                              {p.variant.size || p.variant.colour ? (
                                <p className="text-[10px] text-secondary">
                                  {[p.variant.size, p.variant.colour].filter(Boolean).join(" / ")}
                                </p>
                              ) : null}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-secondary font-mono">{p.variant.sku}</td>
                        <td className="px-4 py-2 text-primary">{p.variant.product.category || "—"}</td>
                        <td className="px-4 py-2 text-primary">{p.variant.product.brand || "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold text-primary">{p.quantity}</td>
                        <td className="px-4 py-2"><StatusPill status={st} /></td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-sm text-secondary">
                        No products match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total > 0 && (
              <div className="flex items-center border-t border-border px-4 py-3 text-[10px] text-secondary bg-slate-50 dark:bg-slate-900">
                <span>Showing 1–{items.length} of {total} products</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
                  <span className="text-xs text-secondary truncate block font-mono">{p.variant.sku}</span>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-primary">{p.quantity} units</span>
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

      <InventoryAnalytics 
        totalUnits={overview.totalUnits}
        inStock={overview.inStock}
        lowStock={overview.lowStock}
        outOfStock={overview.outOfStock}
        stockByCategory={overview.stockByCategory}
        recentMovements={movements}
      />
    </div>
  );
}
