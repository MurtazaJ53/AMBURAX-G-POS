import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import {
  getCatalogFacets,
  getProductDetail,
  listProducts,
  type CatalogFacets,
  type Page as QueryPage,
  type ProductDetail,
  type ProductRow,
} from "@/server/catalog/catalogQueries";
import {
  catalogHref,
  hasActiveFilters,
  parseCatalogFilters,
  type SearchParamsInput,
} from "@/server/catalog/catalogFilters";
import { CatalogFilterPanel } from "@/components/catalog/CatalogFilterPanel";
import { CatalogToolbar, ProductGrid } from "@/components/catalog/CatalogGrid";
import { ProductDetailPanel } from "@/components/catalog/ProductDetailPanel";
import { CatalogMobileFilters } from "@/components/catalog/CatalogMobileFilters";

/**
 * The product catalogue workspace.
 *
 * Three panes, as the design reference has them: filters, the grid, and the selected product.
 * A server component, because every pane is a database read and the whole screen is derived
 * from the URL — filters, sort, view, page and selection all live in the query string, so
 * there is no client state to hydrate and a filtered catalogue is a shareable link.
 *
 * The page size is 12 rather than the shared `PAGE_SIZE` of 20: the reference's grid is four
 * across and three deep, and a 20-item page leaves a ragged final row.
 *
 * Header actions are where this departs most visibly from the reference. Import, Export and
 * Bulk Update are drawn there, and none has an endpoint behind it — no import parser, no
 * export job, no bulk mutation. They are omitted rather than rendered as buttons that would
 * either do nothing or quietly fail, which leaves "Add product" as the one action that
 * genuinely exists.
 */

const CATALOG_PAGE_SIZE = 12;

export default async function ProductsPage(props: { searchParams: Promise<SearchParamsInput> }) {
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");

  const filters = parseCatalogFilters(await props.searchParams);
  const scope = {
    tenantId: resolved.context.tenantId,
    storeId: resolved.context.storeId,
  };

  let result: QueryPage<ProductRow>;
  let facets: CatalogFacets;
  let detail: ProductDetail | null = null;

  try {
    [result, facets, detail] = await Promise.all([
      listProducts({ ...scope, filters, pageSize: CATALOG_PAGE_SIZE }),
      getCatalogFacets(scope),
      // A stale `sel` — a deleted product, or one from another tenant — resolves to null and
      // the panel simply does not open. The query is tenant-scoped, so a guessed id from
      // another business cannot be read here.
      filters.selectedId
        ? getProductDetail({ ...scope, productId: filters.selectedId })
        : Promise.resolve(null),
    ]);
  } catch (err) {
    logError("catalog: workspace load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const canManage = canManageCatalog(resolved.context.tenantRole);
  const panelOpen = detail !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-background-card px-4 py-3 sm:px-5">
        <nav aria-label="Breadcrumb" className="mb-1 text-xs text-tertiary">
          <Link href="/dashboard" className="hover:underline">
            Products
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-secondary">Catalog</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-primary">Product catalog</h1>
            <p className="mt-0.5 text-sm text-secondary">
              Manage your products, variants, prices and stock across stores.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <CatalogMobileFilters filters={filters} facets={facets} />
            {canManage && (
              <Link
                href="/products/new"
                className="inline-flex items-center gap-1.5 rounded px-4 py-2 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                style={{ background: "var(--color-primary)" }}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add product
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-background-card md:block">
          <CatalogFilterPanel filters={filters} facets={facets} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background-app">
          <CatalogToolbar
            filters={filters}
            total={result.total}
            page={result.page}
            pageCount={result.pageCount}
          />

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {result.rows.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-primary">
                  {hasActiveFilters(filters)
                    ? "No products match these filters"
                    : "Your catalogue is empty"}
                </p>
                <p className="mt-1 max-w-sm text-xs text-secondary">
                  {hasActiveFilters(filters)
                    ? "Try widening the filters, or clear them to see the whole catalogue."
                    : "Products added to this business will appear here."}
                </p>
                {hasActiveFilters(filters) ? (
                  <Link
                    href="/products"
                    className="mt-3 text-xs font-medium hover:underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Clear filters
                  </Link>
                ) : (
                  canManage && (
                    <Link
                      href="/products/new"
                      className="mt-3 text-xs font-medium hover:underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      Add your first product
                    </Link>
                  )
                )}
              </div>
            ) : (
              <ProductGrid products={result.rows} filters={filters} panelOpen={panelOpen} />
            )}
          </div>
        </div>

        {/*
          Desktop keeps the panel as a third column. Below xl it would leave the grid a sliver,
          so it becomes a full-width overlay instead — the reference has no mobile layout, and
          shrinking a three-pane workspace onto a phone is what the brief rules out.
        */}
        {detail && (
          <>
            <div className="hidden xl:flex">
              <ProductDetailPanel detail={detail} filters={filters} canManage={canManage} />
            </div>
            <div className="fixed inset-0 z-40 flex xl:hidden" role="dialog" aria-modal="true">
              <Link
                href={catalogHref({ ...filters, selectedId: null })}
                aria-label="Close product details"
                className="flex-1 bg-black/50"
              />
              <div className="flex w-full max-w-md">
                <ProductDetailPanel detail={detail} filters={filters} canManage={canManage} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
