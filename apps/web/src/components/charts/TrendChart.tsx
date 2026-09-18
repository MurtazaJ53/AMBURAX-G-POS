"use client";

import * as React from "react";
import { formatAxisMoney } from "@/server/dashboard/dashboardTransforms";
import { formatMinor } from "@/server/sales/saleTotals";

/**
 * The sales trend — bars for takings, a line for bill count.
 *
 * Hand-drawn SVG rather than a charting library, for two reasons. The design reference uses
 * one chart on one screen, and a charting package is a large client bundle to carry for
 * that; and a library's default tooltip and axis behaviour would have to be overridden
 * almost entirely to match the reference anyway. What is left — a linear scale and a
 * polyline — is arithmetic.
 *
 * Accessibility is not an afterthought here. A chart is an image to a screen reader, so the
 * same figures are also emitted as a real table, visually hidden. A sighted user sees the
 * shape; a screen reader user gets the numbers, which is the thing the shape represents.
 */

export interface TrendChartPoint {
  label: string;
  salesMinor: number;
  billCount: number;
}

export interface TrendChartProps {
  points: TrendChartPoint[];
  /** Describes the window, e.g. "Sales per hour today". Used as the chart's accessible name. */
  caption: string;
  height?: number;
}

const PAD_LEFT = 46;
/**
 * Room for the bill-count axis.
 *
 * The line is on its own scale — bills are counted in tens, takings in thousands — and
 * without a second axis its peaks read as rupees, which is the one thing this chart must not
 * say. Labelling the right edge is what makes the two series legible as two series.
 */
const PAD_RIGHT = 30;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

/** A "nice" ceiling for the axis, so gridlines land on readable numbers rather than 43,712. */
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function TrendChart({ points, caption, height = 200 }: TrendChartProps) {
  const width = 640; // viewBox units; the SVG scales to its container.
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const maxSales = niceCeiling(Math.max(0, ...points.map((p) => p.salesMinor)));
  const maxBills = Math.max(1, ...points.map((p) => p.billCount));

  const slot = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(2, Math.min(22, slot * 0.55));

  const yFor = (value: number, max: number) =>
    max <= 0 ? PAD_TOP + plotHeight : PAD_TOP + plotHeight - (value / max) * plotHeight;

  const xFor = (index: number) => PAD_LEFT + slot * index + slot / 2;

  const gridValues = maxSales > 0 ? [0, 0.25, 0.5, 0.75, 1].map((f) => maxSales * f) : [0];

  // Only every nth label when the range is dense, so 30 days does not overprint itself.
  const labelStride = Math.max(1, Math.ceil(points.length / 12));

  const linePath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.billCount, maxBills).toFixed(1)}`,
    )
    .join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={caption}
        preserveAspectRatio="none"
      >
        {gridValues.map((value) => {
          const y = yFor(value, maxSales);
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-text-tertiary)"
              >
                {formatAxisMoney(value)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => {
          const y = yFor(point.salesMinor, maxSales);
          const barHeight = Math.max(0, PAD_TOP + plotHeight - y);
          return (
            <rect
              key={point.label}
              x={xFor(index) - barWidth / 2}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={3}
              fill="#bfdbfe"
            >
              <title>{`${point.label} — ${formatMinor(point.salesMinor)}, ${point.billCount} bills`}</title>
            </rect>
          );
        })}

        {/* The bill axis, on the right, so the line's height is readable as a count. */}
        {[0, maxBills].map((value) => (
          <text
            key={`bills-${value}`}
            x={width - PAD_RIGHT + 6}
            y={yFor(value, maxBills) + 3}
            textAnchor="start"
            fontSize={9}
            fill="var(--color-text-tertiary)"
          >
            {value}
          </text>
        ))}

        {points.length > 1 && (
          <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth={2} />
        )}

        {points.map((point, index) =>
          index % labelStride === 0 ? (
            <text
              key={`label-${point.label}`}
              x={xFor(index)}
              y={height - 6}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-text-tertiary)"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Sales</th>
              <th scope="col">Bills</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatMinor(point.salesMinor)}</td>
                <td>{point.billCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
