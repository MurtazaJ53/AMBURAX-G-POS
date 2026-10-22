import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { seriesColour, type ShareRow } from "@/server/dashboard/dashboardTransforms";
import { compactRupees } from "./KpiGrid";

export function CategorySalesCard({
  categories,
  uncategorisedMinor,
}: {
  categories: ShareRow[];
  uncategorisedMinor: number;
}) {
  return (
    <div className="surface-card overflow-hidden rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-[13px] font-bold tracking-[-0.01em] text-slate-800">Top categories</h2>
        <Link href="/products" className="text-[10px] font-semibold text-sky-700 hover:text-sky-900">
          Products <ChevronRight className="inline size-3" />
        </Link>
      </div>

      {categories.length === 0 ? (
        <div className="px-4 pb-4 pt-2">
          <p className="text-[12px] font-semibold text-slate-700">No categorised sales today</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {uncategorisedMinor > 0
              ? "Today's sales are all on products with no category set."
              : "Sales grouped by product category will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-4 pb-4 pt-2">
          {categories.map((category, index) => (
            <div key={category.key}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="truncate font-semibold text-slate-700">{category.label}</span>
                <span className="shrink-0 text-slate-500">
                  {formatMinor(category.amountMinor)} <b className="ml-1 text-slate-600">{category.sharePct ?? 0}%</b>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                {/* Scaled, not resized: motion stays on transform only (see globals.css). */}
                <div
                  className="h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-300"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(100, category.sharePct ?? 0)) / 100})`, background: seriesColour(index) }}
                />
              </div>
            </div>
          ))}

          {uncategorisedMinor > 0 && (
            <p className="mt-3 text-[10px] text-slate-600">
              Shares are of categorised sales only. {formatMinor(uncategorisedMinor)} sold today
              sits on products with no category.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function paymentGradient(payments: { sharePct: number | null; colour: string }[]) {
  let cursor = 0;
  return `conic-gradient(${payments.map((payment) => {
    const start = cursor;
    cursor += payment.sharePct ?? 0;
    return `${payment.colour} ${start}% ${cursor}%`;
  }).join(', ')})`;
}

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
    <div className="surface-card overflow-hidden rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-[13px] font-bold tracking-[-0.01em] text-slate-800">Payment methods</h2>
      </div>

      {rows.length === 0 || totalMinor === 0 ? (
        <div className="px-4 pb-4 pt-2">
          <p className="text-[12px] font-semibold text-slate-700">Nothing settled yet today</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The split across cash, UPI and card appears once bills are paid.
          </p>
        </div>
      ) : (
        // Stacks (chart above legend) when the card is narrow, so the legend never runs off the edge.
        <div className="flex flex-wrap items-center justify-center gap-4 px-4 pb-4 pt-2">
          <div 
            className="relative size-[112px] shrink-0 rounded-full bg-slate-100" 
            style={{ background: paymentGradient(slices) }}
            role="img"
            // The chart's text alternative carries the same shares the legend shows.
            aria-label={`Payment method breakdown: ${slices.map((s) => `${s.label} ${s.sharePct ?? 0}%`).join(", ")}`}
          >
            <div className="absolute inset-[13px] flex flex-col items-center justify-center rounded-full bg-white">
              <strong className="data-mono text-[13px] font-bold text-slate-800" title={formatMinor(totalMinor)}>
                {compactRupees(totalMinor).short}
              </strong>
              <span className="text-[8px] text-slate-600">Total sales</span>
            </div>
          </div>
          <div className="min-w-[8rem] flex-1 space-y-2">
            {slices.map((payment) => (
              <div key={payment.label} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <i className="size-1.5 rounded-full" style={{ background: payment.colour }} aria-hidden="true" />
                  {payment.label}
                </span>
                <b className="text-slate-700">{payment.sharePct}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
