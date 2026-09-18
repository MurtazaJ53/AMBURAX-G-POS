"use client";

import * as React from "react";
import { TrendChart } from "@/components/charts/TrendChart";
import { TREND_RANGES, type TrendRange } from "@/server/dashboard/dashboardTransforms";
import { DashboardCard, DashboardCardHeader, WidgetEmpty } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * The sales trend, with the reference's four-way range switch.
 *
 * The first range is rendered on the server and handed down, so the card is complete on
 * first paint and nothing flashes. Only a *change* of range goes to the network, and the
 * fetch is aborted if the operator clicks a third tab before the second returns — otherwise
 * a slow response for "7 days" could land after a fast one for "30 days" and leave the chart
 * disagreeing with its own highlighted tab.
 */

export interface TrendPointDto {
  label: string;
  salesMinor: number;
  billCount: number;
}

export interface SalesTrendCardProps {
  initialPoints: TrendPointDto[];
  initialRange: TrendRange;
}

type LoadState = "idle" | "loading" | "error";

export function SalesTrendCard({ initialPoints, initialRange }: SalesTrendCardProps) {
  const [range, setRange] = React.useState<TrendRange>(initialRange);
  const [points, setPoints] = React.useState<TrendPointDto[]>(initialPoints);
  const [state, setState] = React.useState<LoadState>("idle");

  const requestRef = React.useRef<AbortController | null>(null);

  async function selectRange(next: TrendRange) {
    if (next === range && state !== "error") return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setRange(next);
    setState("loading");

    try {
      const response = await fetch(`/api/v1/dashboard/trend?range=${next}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`trend request failed: ${response.status}`);
      const body = (await response.json()) as { points?: TrendPointDto[] };
      setPoints(body.points ?? []);
      setState("idle");
    } catch {
      if (controller.signal.aborted) return;
      setState("error");
    }
  }

  React.useEffect(() => () => requestRef.current?.abort(), []);

  const activeLabel = TREND_RANGES.find((option) => option.id === range)?.label ?? "Today";
  const hasTrade = points.some((point) => point.billCount > 0);

  return (
    <DashboardCard aria-labelledby="sales-trend-heading">
      <DashboardCardHeader
        id="sales-trend-heading"
        title={range === "today" || range === "yesterday" ? "Hourly sales" : "Daily sales"}
        action={
          <div
            role="tablist"
            aria-label="Sales trend range"
            className="flex overflow-hidden rounded-xl border border-border"
          >
            {TREND_RANGES.map((option) => {
              const active = option.id === range;
              return (
                <button
                  key={option.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => void selectRange(option.id)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus",
                    active ? "text-white" : "text-secondary hover:bg-background-hover",
                  )}
                  style={active ? { background: "var(--color-primary)" } : undefined}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        }
      />

      {state === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-danger-subtle px-4 py-8 text-center">
          <p className="text-sm font-medium text-danger">The trend didn&apos;t load</p>
          <p className="mt-1 text-xs text-secondary">
            Your sales are safe — this chart alone failed to refresh.
          </p>
          <button
            type="button"
            onClick={() => void selectRange(range)}
            className="mt-4 rounded-lg border border-border bg-background-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-background-hover"
          >
            Try again
          </button>
        </div>
      ) : state === "loading" ? (
        <div
          className="flex-1 animate-pulse rounded-xl bg-background-subtle"
          style={{ minHeight: 200 }}
          role="status"
          aria-label={`Loading ${activeLabel} sales`}
        />
      ) : hasTrade ? (
        <TrendChart points={points} caption={`Sales and bill count, ${activeLabel.toLowerCase()}`} />
      ) : (
        <WidgetEmpty
          title={`No sales recorded for ${activeLabel.toLowerCase()}`}
          description="Completed bills appear here as soon as the till rings one up."
        />
      )}

      {/* Dots for both series, as the reference has them — the line no longer prints an axis,
          so a line swatch would imply a scale that is not on the chart. */}
      <div className="mt-2 flex items-center justify-center gap-5">
        <span className="flex items-center gap-1.5 text-[11px] text-secondary">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#bfdbfe]" />
          Sales (₹)
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--color-primary)" }}
          />
          Bills
        </span>
      </div>
    </DashboardCard>
  );
}
