import * as React from "react";
import { DonutChart } from "@/components/charts/DonutChart";
import { formatMinor } from "@/server/sales/saleTotals";
import { seriesColour, type ShareRow } from "@/server/dashboard/dashboardTransforms";
import { CardLink, DashboardCard, DashboardCardHeader, ShareBar, WidgetEmpty } from "./primitives";

/**
 * The two ranking cards that sit beside the trend: what sold, and how it was paid for.
 *
 * They share a file because they share a shape — a ranked list of shares over today's
 * takings — and keeping them together is what stops one of them growing a slightly different
 * idea of how a percentage is rendered.
 */

/**
 * Category mix.
 *
 * The percentages are shares of *categorised* revenue, and the card says so whenever any
 * revenue was uncategorised. This matters more than it looks: a shop with two categorised
 * products and forty uncategorised ones would otherwise read "Shirts 100%", which is true of
 * the denominator and wildly false about the business.
 */
export function CategorySalesCard({
  categories,
  uncategorisedMinor,
}: {
  categories: ShareRow[];
  uncategorisedMinor: number;
}) {
  return (
    <DashboardCard aria-labelledby="category-sales-heading">
      <DashboardCardHeader
        id="category-sales-heading"
        title="Top categories"
        action={<CardLink href="/products">Products</CardLink>}
      />

      {categories.length === 0 ? (
        <WidgetEmpty
          title="No categorised sales today"
          description={
            uncategorisedMinor > 0
              ? "Today's sales are all on products with no category set."
              : "Sales grouped by product category will appear here."
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {categories.map((category, index) => (
              <li key={category.key}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-secondary">
                    {category.label}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-semibold text-primary">
                      {formatMinor(category.amountMinor)}
                    </span>
                    <span className="text-[10px] text-tertiary">
                      {category.sharePct === null ? "—" : `${category.sharePct}%`}
                    </span>
                  </span>
                </div>
                <ShareBar pct={category.sharePct ?? 0} colour={seriesColour(index)} />
              </li>
            ))}
          </ul>

          {uncategorisedMinor > 0 && (
            <p className="mt-3 text-[10px] text-tertiary">
              Shares are of categorised sales only. {formatMinor(uncategorisedMinor)} sold today
              sits on products with no category.
            </p>
          )}
        </>
      )}
    </DashboardCard>
  );
}

/**
 * Payment split.
 *
 * Only the tenders the schema actually has — cash, UPI and card. The design reference also
 * shows a wallet slice; there is no wallet method in `PaymentMethod`, so inventing one would
 * mean drawing a segment that can never be non-zero.
 */
export function PaymentMethodsCard({
  rows,
  totalMinor,
}: {
  rows: ShareRow[];
  totalMinor: number;
}) {
  const slices = rows.map((row, index) => ({
    key: row.key,
    label: row.label,
    sharePct: row.sharePct,
    colour: seriesColour(index),
  }));

  return (
    <DashboardCard aria-labelledby="payment-methods-heading">
      <DashboardCardHeader id="payment-methods-heading" title="Payment methods" />

      {rows.length === 0 || totalMinor === 0 ? (
        <WidgetEmpty
          title="Nothing settled yet today"
          description="The split across cash, UPI and card appears once bills are paid."
        />
      ) : (
        <>
          <div className="flex justify-center">
            <DonutChart
              slices={slices}
              centreLabel={formatMinor(totalMinor)}
              centreCaption="Settled today"
            />
          </div>
          {/* Capped and centred: in the reference this card is a 220px column, and when the
              grid gives it the full width instead the legend would otherwise stretch its
              label and percentage to opposite edges. */}
          <ul className="mx-auto mt-3 grid w-full max-w-[16rem] grid-cols-2 gap-x-3 gap-y-1.5">
            {rows.map((row, index) => (
              <li key={row.key} className="flex items-center gap-1.5 text-[11px] text-secondary">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: seriesColour(index) }}
                />
                <span className="truncate">{row.label}</span>
                <span className="ml-auto shrink-0 text-tertiary">
                  {row.sharePct === null ? "—" : `${row.sharePct}%`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardCard>
  );
}
