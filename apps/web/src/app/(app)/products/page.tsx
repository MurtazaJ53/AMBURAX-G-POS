import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import {
  listProducts,
  getCatalogSummary,
  PAGE_SIZE,
  type Page,
  type ProductRow,
  type CatalogSummary,
} from "@/server/catalog/catalogQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import {
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  StockBadge,
  buttonClass,
  LinkButton,
} from "../_components/ui";

function priceRange(product: ProductRow): string {
  if (product.priceFromMinor == null || product.priceToMinor == null) return "No price";
  if (product.priceFromMinor === product.priceToMinor)
    return formatMinor(product.priceFromMinor);
  return `${formatMinor(product.priceFromMinor)} - ${formatMinor(product.priceToMinor)}`;
}

export default async function ProductsPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");

  const searchParams = await props.searchParams;
  const query = searchParams.q;
  const page = searchParams.page ? parseInt(searchParams.page, 10) || 1 : 1;

  let result: Page<ProductRow>;
  let summary: CatalogSummary;
  try {
    [result, summary] = await Promise.all([
      listProducts({ tenantId: resolved.context.tenantId, storeId: resolved.context.storeId, query, page }),
      getCatalogSummary({ tenantId: resolved.context.tenantId, storeId: resolved.context.storeId }),
    ]);
  } catch (err) {
    logError("catalog: product list failed", err);
    return <ServiceUnavailableScreen />;
  }
  
  const canEdit = canManageCatalog(resolved.context.tenantRole);

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Product catalogue"
        subtitle="Products, variants and prices for your business"
        actions={
          canEdit ? (
            <LinkButton href="/products/new" variant="primary">
              + Add Product
            </LinkButton>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Products" value={String(summary.products)} tone="blue" />
        <KpiCard
          label="Variants"
          value={String(summary.variants)}
          hint="Sellable SKUs"
          tone="violet"
        />
        <KpiCard
          label="Counted in this store"
          value={String(summary.counted)}
          hint={`${Math.max(0, summary.variants - summary.counted)} never counted here`}
          tone="emerald"
        />
      </div>

      <Card className="mt-6">
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4"
        >
          <label htmlFor="product-q" className="sr-only">
            Search products by name, SKU, barcode, category or brand
          </label>
          <input
            id="product-q"
            name="q"
            defaultValue={query}
            placeholder="Search by name, SKU, barcode, category or brand"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button type="submit" className={buttonClass("primary")}>
            Search
          </button>
          {query && (
            <Link href="/products" className={buttonClass("secondary")}>
              Clear
            </Link>
          )}
        </form>

        {result.rows.length === 0 ? (
          query ? (
            <EmptyState
              title={`No products match "${query}"`}
              description="Try a product name, SKU, barcode, category or brand."
              action={
                <Link href="/products" className={buttonClass("secondary")}>
                  Clear search
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No products yet"
              description="Your catalogue is empty. Products added to this business will appear here."
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {result.rows.map((product) => (
                <li key={product.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-400"
                      >
                        {product.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/products/${product.id}`} className="hover:underline">
                          <h2 className="text-sm font-semibold text-slate-900">{product.name}</h2>
                        </Link>
                        {!product.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[product.category, product.brand].filter(Boolean).join(" A ") ||
                          "Uncategorised"}
                        {" A "}
                        {product.variantCount} {product.variantCount === 1 ? "variant" : "variants"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{priceRange(product)}</p>
                      <div className="mt-1">
                        <StockBadge quantity={product.stockQuantity} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <Pagination
              basePath="/products"
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={PAGE_SIZE}
              params={{ q: query || undefined }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
