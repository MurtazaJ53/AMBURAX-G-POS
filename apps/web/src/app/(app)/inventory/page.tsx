import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { getInventoryOverview, listStockLevels, listStoreStockMovements, getInventoryFilterOptions, getInventoryFacetCounts, stockStatusLabel } from "@/server/inventory/inventoryQueries";
import { Package, Boxes, ArrowRightLeft, AlertTriangle, AlertOctagon, Plus, Download } from "lucide-react";

import { StatusPill } from "@/components/inventory/InventoryUI";
import { KpiCard } from "@/components/dashboard/KpiGrid";
import { InventoryDetailPanel } from "@/components/inventory/InventoryDetailPanel";
import { InventoryToolbar } from "@/components/inventory/InventoryToolbar";
import { InventoryAnalytics } from "@/components/inventory/InventoryAnalytics";
import { InventoryTabs, type InventoryTab } from "@/components/inventory/InventoryTabs";
import { InventoryFacetList } from "@/components/inventory/InventoryFacetList";
import { InventoryVariantList } from "@/components/inventory/InventoryVariantList";

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
  // Read-only Variants / Categories / Brands tabs; any other value is ignored and the stock list shows.
  const tab: InventoryTab | undefined =
    searchParams.tab === "variants" || searchParams.tab === "categories" || searchParams.tab === "brands"
      ? searchParams.tab
      : undefined;
  const facetValues =
    tab === "categories" || tab === "brands"
      ? await getInventoryFacetCounts({ tenantId, storeId, kind: tab === "categories" ? "category" : "brand" })
      : [];

  const pageRaw = parseInt(typeof searchParams.page === "string" ? searchParams.page : "1", 10);
  const page = isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;
  const limit = 50;
  const offset = (page - 1) * limit;

  // Variants tab: one row per variant stocked in this store, from the same tenant/store-scoped
  // query as the stock table, unfiltered.
  const variantPage = tab === "variants" ? await listStockLevels({ tenantId, storeId, limit, offset }) : null;

  const [overview, { items, total }, { items: movements }, { categories, brands }] = await Promise.all([
    getInventoryOverview({ tenantId, storeId }),
    listStockLevels({ tenantId, storeId, search, status, category, brand, limit, offset }),
    listStoreStockMovements({ tenantId, storeId, limit: 10, offset: 0 }),
    getInventoryFilterOptions({ tenantId, storeId })
  ]);

  const selectedItem = selectedSku ? items.find((i) => i.variant.sku === selectedSku) : undefined;

  const createSelectHref = (sku: string | undefined) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (view !== "table") p.set("view", view);
    if (page > 1) p.set("page", String(page));
    if (sku) p.set("selected", sku);
    return `/inventory?${p.toString()}`;
  };

  const createPageHref = (newPage: number) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (view !== "table") p.set("view", view);
    if (selectedSku) p.set("selected", selectedSku);
    if (newPage > 1) p.set("page", String(newPage));
    return `/inventory?${p.toString()}`;
  };

  // One footer for both views: the same page, range and filter-preserving links, so grid view
  // reaches every page the table does.
  const pagination = total > 0 ? (
    <div className="flex-none flex items-center justify-between border-t border-border px-4 py-3 text-[10px] text-secondary bg-slate-50">
      <span>Showing {offset + 1}&mdash;{Math.min(offset + limit, total)} of {total} products</span>
      <div className="flex items-center gap-2">
        <Link 
          href={createPageHref(page - 1)}
          className={`inline-flex h-7 items-center justify-center rounded-[4px] border border-border bg-white px-3 font-medium transition-colors hover:bg-slate-50 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : 0}
        >
          Previous
        </Link>
        <Link 
          href={createPageHref(page + 1)}
          className={`inline-flex h-7 items-center justify-center rounded-[4px] border border-border bg-white px-3 font-medium transition-colors hover:bg-slate-50 ${offset + limit >= total ? "pointer-events-none opacity-50" : ""}`}
          aria-disabled={offset + limit >= total}
          tabIndex={offset + limit >= total ? -1 : 0}
        >
          Next
        </Link>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex-1 w-full p-4 pb-12 sm:p-6 lg:p-8 flex flex-col min-w-0">
      <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Workspace / Inventory</div>
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-slate-900">Inventory</h1>
          <p className="mt-1 text-[11.5px] text-slate-500">Track your stock, variants and keep your store always ready.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/v1/inventory/export"
            download
            className="amb-focus amb-press inline-flex h-8 items-center justify-center rounded border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            <Download size={13} className="mr-1.5 text-slate-500" /> Export CSV
          </a>
          {canManage ? (
            <Link href="/products/new" className="amb-focus amb-press inline-flex h-8 items-center justify-center rounded px-3 text-[11px] font-semibold text-white shadow-sm bg-primary hover:bg-primary-hover transition-colors">
              <Plus size={13} className="mr-1.5" /> Add Product
            </Link>
          ) : (
            <button disabled className="inline-flex h-8 items-center justify-center rounded px-3 text-[11px] font-semibold text-white bg-primary opacity-50 cursor-not-allowed shadow-sm">
              <Plus size={13} className="mr-1.5" /> Add Product
            </button>
          )}
        </div>
      </header>

      <div className="flex-none mt-6 border-b border-border">
        <InventoryTabs status={status} tab={tab} />
      </div>

      <div className="flex-none grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 mt-5 mb-5">
        <KpiCard icon={Package} label="TOTAL TRACKED" value={String(overview.totalItems)} hint="Across this store" toneClass="bg-violet-100 text-violet-700" />
        <KpiCard icon={Boxes} label="TOTAL UNITS" value={String(overview.totalUnits)} hint="Current on-hand units" toneClass="bg-sky-100 text-sky-700" />
        <KpiCard icon={ArrowRightLeft} label="RECENT ACTIVITY (7D)" value={String(overview.recentMovements)} hint="Movements in last 7 days" toneClass="bg-teal-100 text-teal-700" />
        <KpiCard icon={AlertTriangle} label="LOW STOCK" value={String(overview.lowStock)} hint="Across this store" toneClass="bg-amber-100 text-amber-700" />
        <KpiCard icon={AlertOctagon} label="OUT OF STOCK" value={String(overview.outOfStock)} hint="Across this store" toneClass="bg-rose-100 text-rose-700" />
      </div>

      {tab === "variants" && variantPage ? (
        <InventoryVariantList rows={variantPage.items} total={variantPage.total} page={page} pageSize={limit} />
      ) : tab ? (
        <InventoryFacetList kind={tab === "categories" ? "category" : "brand"} values={facetValues} />
      ) : (
      <>
      <div className="flex-none">
        <InventoryToolbar
          search={search}
          status={status}
          category={category}
          brand={brand}
          view={view}
          page={page}
          categories={categories}
          brands={brands}
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
                    <th className="px-4 py-2 text-right font-semibold">Stock</th>
                    <th className="px-4 py-2 text-right font-semibold">Available</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map(p => {
                    const st = stockStatusLabel(p.quantity);
                    return (
                      <tr 
                        key={p.variant.sku} 
                        className={`h-9 hover:bg-slate-50 transition-colors ${selectedSku === p.variant.sku ? "bg-slate-50" : ""}`}
                      >
                        <td className="px-4 py-1.5 min-w-0">
                          <Link href={createSelectHref(p.variant.sku)} className="flex items-center gap-2 group">
                            <div className="h-7 w-7 shrink-0 overflow-hidden rounded-[3px] bg-background-app flex items-center justify-center">
                              {p.variant.product.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
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
                        <td className="px-4 py-1.5 text-right font-mono text-[13px] font-bold text-primary">{p.quantity}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-[11px] text-tertiary">{p.quantity}</td>
                        <td className="px-4 py-1.5 w-[140px]"><StatusPill status={st} /></td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-sm text-secondary">
                        No products match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pagination}
          </div>
        ) : (
          <div className="flex flex-col min-w-0 min-h-0 gap-3">
            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 content-start pr-1">
              {items.length === 0 ? (
                <p className="col-span-full rounded-[6px] border border-border bg-background-card p-12 text-center text-sm text-secondary">
                  No products match your filters.
                </p>
              ) : items.map(p => {
                const st = stockStatusLabel(p.quantity);
                return (
                  <Link 
                    key={p.variant.sku} 
                    href={createSelectHref(p.variant.sku)} 
                    className={`rounded-lg border bg-background-card p-3 text-left shadow-sm hover:border-primary transition-colors ${selectedSku === p.variant.sku ? "border-primary ring-1 ring-primary" : "border-border"}`}
                  >
                    <div className="h-32 w-full rounded-md bg-background-app mb-3 flex items-center justify-center overflow-hidden">
                      {p.variant.product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
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
            {pagination ? (
              <div className="overflow-hidden rounded-[6px] border border-border">{pagination}</div>
            ) : null}
          </div>
        )}

        {selectedItem && (
          <InventoryDetailPanel item={selectedItem} closeHref={createSelectHref(undefined)} canManage={canManage} />
        )}
      </div>
      </>
      )}

      <div className="flex-none">
        <InventoryAnalytics 
          totalUnits={overview.totalUnits}
          inStock={overview.inStock}
          lowStock={overview.lowStock}
          outOfStock={overview.outOfStock}
          oversold={overview.oversold}
          stockByCategory={overview.stockByCategory}
          categoryCount={overview.categoryCount}
          recentMovements={movements}
        />
      </div>
    </div>
  );
}
