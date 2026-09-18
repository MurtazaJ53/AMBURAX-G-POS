import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  listInventory,
  getCatalogSummary,
  PAGE_SIZE,
  type Page,
  type InventoryRow,
  type CatalogSummary,
} from "@/server/catalog/catalogQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../sales/formatDateTime";
import {
  Card,
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StockBadge,
  Td,
  Th,
  buttonClass,
} from "../_components/ui";

/**
 * Inventory — the store's operational stock count.
 *
 * The single most important thing on this screen is what it is *called*. These numbers are
 * AMBURAX's own operational count, maintained by decrementing on each sale. They are not an
 * ERPNext stock ledger, not accounting-authoritative, and nothing has reconciled them
 * against anything (ADR-001, ADR-080). The heading and the banner both say so, because a
 * merchant who believes this is the authoritative ledger will make purchasing decisions on
 * it.
 *
 * Three columns from the design reference are absent because the data does not exist:
 * stock *value* (no cost price on `ProductVariant`), *reserved* quantity (no reservation
 * model), and a *low stock* flag (no reorder level). Rendering any of them would mean
 * inventing the number.
 */
export default async function InventoryPage({
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
    logError("inventory: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/home");
  const context = resolved.context;

  let result: Page<InventoryRow>;
  let summary: CatalogSummary;
  try {
    [result, summary] = await Promise.all([
      listInventory({ tenantId: context.tenantId, storeId: context.storeId, query, page }),
      getCatalogSummary({ tenantId: context.tenantId, storeId: context.storeId }),
    ]);
  } catch (err) {
    logError("inventory: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Inventory"
        subtitle={`Operational stock count for ${context.storeName} — maintained by AMBURAX, not an accounting stock ledger`}
      />

      {/* Not decoration. This is the one claim the screen must never get wrong, stated
          before any number is read. */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 text-amber-600">
          ⚠
        </span>
        <div className="text-sm text-amber-800">
          <p className="font-medium">These are AMBURAX operational counts</p>
          <p className="mt-0.5 text-amber-700">
            They move when a sale is completed here. They are not reconciled against an
            accounting stock ledger, and nothing currently prevents a sale from taking a count
            below zero.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Variants counted"
          value={String(summary.counted)}
          hint={`of ${summary.variants} in the catalogue`}
          tone="blue"
        />
        <KpiCard
          label="Units on hand"
          value={String(summary.unitsOnHand)}
          hint="Sum of counted quantities"
          tone="violet"
        />
        <KpiCard
          label="Out of stock"
          value={String(summary.outOfStock)}
          hint="At zero"
          tone="amber"
        />
        <KpiCard
          label="Oversold"
          value={String(summary.oversold)}
          hint="Counted below zero"
          tone="rose"
        />
      </div>

      <Card className="mt-6">
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4"
        >
          <label htmlFor="inventory-q" className="sr-only">
            Search stock by product name, SKU or barcode
          </label>
          <input
            id="inventory-q"
            name="q"
            defaultValue={query}
            placeholder="Search by product name, SKU or barcode"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button type="submit" className={buttonClass("primary")}>
            Search
          </button>
          {query && (
            <Link href="/inventory" className={buttonClass("secondary")}>
              Clear
            </Link>
          )}
        </form>

        {result.rows.length === 0 ? (
          query ? (
            <EmptyState
              title={`Nothing matches “${query}”`}
              description="Try a product name, SKU or barcode."
              action={
                <Link href="/inventory" className={buttonClass("secondary")}>
                  Clear search
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No stock to show"
              description="Once your catalogue has variants, their counts for this store appear here."
            />
          )
        ) : (
          <>
            <DataTable caption="Operational stock by variant">
              <thead className="border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <Th>Product</Th>
                  <Th>SKU</Th>
                  <Th>Variant</Th>
                  <Th>Category</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">On hand</Th>
                  <Th>Status</Th>
                  <Th>Last movement</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {result.rows.map((row) => (
                  <tr key={row.variantId} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{row.productName}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{row.sku}</Td>
                    <Td className="text-slate-500">
                      {[row.colour, row.size].filter(Boolean).join(" · ") || "—"}
                    </Td>
                    <Td className="text-slate-500">{row.category ?? "—"}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {formatMinor(row.priceMinor)}
                    </Td>
                    <Td align="right" className="font-medium text-slate-900">
                      {/* Never counted is not zero, and must not be displayed as zero. */}
                      {row.quantity === null ? "—" : row.quantity}
                    </Td>
                    <Td>
                      <StockBadge quantity={row.quantity} />
                    </Td>
                    <Td className="whitespace-nowrap text-slate-400">
                      {row.updatedAt ? formatDateTime(row.updatedAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>

            <Pagination
              basePath="/inventory"
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={PAGE_SIZE}
              params={{ q: query || undefined }}
            />
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Stock adjustments, transfers, stock takes, reorder levels and ERPNext reconciliation
        arrive in Phase 4. Today stock only moves when a sale is completed.
      </p>
    </div>
  );
}
