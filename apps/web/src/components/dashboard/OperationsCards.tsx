import * as React from "react";
import Link from "next/link";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatStoreTime } from "@/server/dashboard/dashboardTransforms";
import type { DashboardBreakdown, DashboardStockSignal } from "@/server/dashboard/dashboardQueries";
import type { SaleListRow } from "@/server/sales/saleQueries";
import {
  CardLink,
  DashboardCard,
  DashboardCardHeader,
  DenseTable,
  Td,
  Th,
  WidgetEmpty,
} from "./primitives";

/**
 * The three operational tables along the lower half of the reference.
 *
 * Each is a straight rendering of rows the database returned. Nothing here derives a figure
 * the query did not already state, which is what keeps the tables reconcilable against the
 * sales list and the inventory screen they link to.
 */

export function FastMovingProductsCard({
  products,
}: {
  products: DashboardBreakdown["topProducts"];
}) {
  return (
    <DashboardCard aria-labelledby="fast-moving-heading">
      <DashboardCardHeader
        id="fast-moving-heading"
        title="Fast moving today"
        action={<CardLink href="/sales">Sales</CardLink>}
      />

      {products.length === 0 ? (
        <WidgetEmpty
          title="Nothing sold yet today"
          description="The day's best sellers are ranked here by units sold."
        />
      ) : (
        <DenseTable caption="Fastest moving products today, by units sold">
          <thead className="border-b border-border">
            <tr>
              <Th className="w-5">#</Th>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th align="right">Sold</Th>
              <Th align="right">Revenue</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map((product, index) => (
              <tr key={product.variantId} className="hover:bg-background-hover">
                <Td className="text-tertiary">{index + 1}</Td>
                <Td className="font-medium text-primary">{product.name}</Td>
                <Td className="text-tertiary">{product.sku}</Td>
                <Td align="right" className="text-secondary">
                  {product.unitsSold}
                </Td>
                <Td align="right" className="font-semibold text-primary">
                  {formatMinor(product.revenueMinor)}
                </Td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
    </DashboardCard>
  );
}

/**
 * The stock card, which the reference calls "Low Stock Alert" and this one does not.
 *
 * There is no reorder level in the schema, so "low" has no threshold to be measured against
 * and the word would be a claim the data cannot support (ADR-080). What is shown instead is
 * the count itself, thinnest first, with the zero and negative rows called out — and a line
 * saying plainly why no reorder column appears.
 */
export function StockSignalCard({ stock }: { stock: DashboardStockSignal }) {
  const critical = stock.outOfStock + stock.oversold;

  return (
    <DashboardCard aria-labelledby="stock-signal-heading">
      <DashboardCardHeader
        id="stock-signal-heading"
        title="Stock signal"
        badge={
          critical > 0 ? (
            <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-[10px] font-bold text-danger">
              {critical} to check
            </span>
          ) : undefined
        }
        action={<CardLink href="/inventory">Inventory</CardLink>}
      />

      {stock.lowest.length === 0 ? (
        <WidgetEmpty
          title="Nothing counted in this store yet"
          description="Once stock is counted here, the thinnest lines appear in this card."
        />
      ) : (
        <>
          <DenseTable caption="Lowest stock counts in this store">
            <thead className="border-b border-border">
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th align="right">Counted</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stock.lowest.map((row) => (
                <tr key={row.variantId} className="hover:bg-background-hover">
                  <Td className="font-medium text-primary">{row.productName}</Td>
                  <Td className="text-tertiary">{row.sku}</Td>
                  <Td align="right">
                    <span
                      className={
                        row.quantity < 0
                          ? "rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-bold text-danger"
                          : row.quantity === 0
                            ? "rounded bg-warning-subtle px-1.5 py-0.5 text-[10px] font-bold text-warning"
                            : "text-secondary"
                      }
                    >
                      {row.quantity}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DenseTable>

          <p className="mt-3 border-t border-border pt-2 text-[10px] text-tertiary">
            An operational count, not an accounting ledger. No reorder levels are configured, so
            AMBURAX does not flag stock as low — only what it has counted.
          </p>
        </>
      )}
    </DashboardCard>
  );
}

export function RecentSalesCard({ sales }: { sales: SaleListRow[] }) {
  return (
    <DashboardCard aria-labelledby="recent-sales-heading">
      <DashboardCardHeader
        id="recent-sales-heading"
        title="Recent sales"
        action={<CardLink href="/sales">View all</CardLink>}
      />

      {sales.length === 0 ? (
        <WidgetEmpty title="No sales yet" description="Completed bills in this store appear here." />
      ) : (
        <DenseTable caption="Most recent completed bills in this store">
          <thead className="border-b border-border">
            <tr>
              <Th>Time</Th>
              <Th>Bill no.</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th align="center">Accounting</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sales.map((sale) => (
              <tr key={sale.id} className="hover:bg-background-hover">
                <Td className="whitespace-nowrap text-tertiary">
                  {formatStoreTime(sale.completedAt)}
                </Td>
                <Td>
                  <Link
                    href={`/sales/${sale.id}`}
                    className="font-medium hover:underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {sale.billNumber}
                  </Link>
                </Td>
                <Td className="text-secondary">{sale.customerName ?? "Walk-in"}</Td>
                <Td align="right" className="font-semibold text-primary">
                  {formatMinor(sale.totalMinor)}
                </Td>
                <Td align="center">
                  {/* No ERPNext adapter exists, so this is "not posted" for every row today.
                      Showing it per bill is what stops the list implying the books are up to
                      date. */}
                  {sale.erpSyncStatus === "SYNCED" ? (
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success">
                      Posted
                    </span>
                  ) : (
                    <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-semibold text-warning">
                      Not posted
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
    </DashboardCard>
  );
}
