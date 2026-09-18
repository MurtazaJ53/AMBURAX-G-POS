import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
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
} from "../_components/ui";

/**
 * Product catalogue.
 *
 * Nothing on this screen is garment-specific. Size and colour are rendered only when a
 * variant actually carries them, so a retailer selling hardware or groceries sees a clean
 * SKU list rather than empty "Size —" columns. That is the difference between a garment
 * product and a retail product with garments as its first vertical.
 *
 * The design reference leans heavily on product photography. There is no image column in
 * the schema, so each product shows a neutral monogram tile: a placeholder that is visibly
 * a placeholder beats a stock photo that misrepresents what the merchant actually sells.
 */

function variantLabel(variant: { size: string | null; colour: string | null }): string | null {
  const parts = [variant.colour, variant.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function priceRange(product: ProductRow): string {
  if (product.priceFromMinor === null || product.priceToMinor === null) return "—";
  return product.priceFromMinor === product.priceToMinor
    ? formatMinor(product.priceFromMinor)
    : `${formatMinor(product.priceFromMinor)} – ${formatMinor(product.priceToMinor)}`;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("products: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");
  const context = resolved.context;

  let result: Page<ProductRow>;
  let summary: CatalogSummary;
  try {
    [result, summary] = await Promise.all([
      listProducts({ tenantId: context.tenantId, storeId: context.storeId, query, page }),
      getCatalogSummary({ tenantId: context.tenantId, storeId: context.storeId }),
    ]);
  } catch (err) {
    logError("products: catalogue load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Product catalogue"
        subtitle="Products, variants and prices for your business"
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
              title={`No products match “${query}”`}
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
                    {/* Honest placeholder: no image column exists in the schema. */}
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-400"
                    >
                      {product.name.slice(0, 2).toUpperCase()}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-slate-900">{product.name}</h2>
                        {!product.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[product.category, product.brand].filter(Boolean).join(" · ") ||
                          "Uncategorised"}
                        {" · "}
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

                  {/* Variants inline rather than behind a click: at this scale the operator
                      wants the SKU list, not a drill-down. */}
                  {product.variants.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-xs">
                        <caption className="sr-only">Variants of {product.name}</caption>
                        <thead>
                          <tr className="text-left text-slate-400">
                            <th scope="col" className="py-1.5 pr-3 font-medium">
                              SKU
                            </th>
                            <th scope="col" className="py-1.5 pr-3 font-medium">
                              Variant
                            </th>
                            <th scope="col" className="py-1.5 pr-3 font-medium">
                              Barcode
                            </th>
                            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                              MRP
                            </th>
                            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                              Price
                            </th>
                            <th scope="col" className="py-1.5 font-medium">
                              Stock
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {product.variants.map((variant) => (
                            <tr key={variant.id}>
                              <td className="whitespace-nowrap py-1.5 pr-3 font-medium text-slate-700">
                                {variant.sku}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-500">
                                {variantLabel(variant) ?? "—"}
                              </td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-slate-400">
                                {variant.barcode ?? "—"}
                              </td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-slate-400">
                                {/* Struck through only when MRP genuinely exceeds the
                                    selling price — otherwise it is not a saving. */}
                                {variant.mrpMinor && variant.mrpMinor > variant.priceMinor ? (
                                  <s>{formatMinor(variant.mrpMinor)}</s>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium text-slate-900">
                                {formatMinor(variant.priceMinor)}
                              </td>
                              <td className="py-1.5">
                                <StockBadge quantity={variant.stockQuantity} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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

      {/*
        Stated once, plainly: this catalogue is AMBURAX's own. There is no ERPNext Item sync
        yet, and editing is not built — a merchant must not believe either exists.
      */}
      <p className="mt-4 text-xs text-slate-400">
        Products are read-only here for now. Adding and editing arrive with the catalogue
        workspace in Phase 4, along with ERPNext Item synchronisation.
      </p>
    </div>
  );
}
