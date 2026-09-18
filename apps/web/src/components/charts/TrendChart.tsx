"use client";

import * as React from "react";
import { formatAxisMoney } from "@/server/dashboard/dashboardTransforms";
import { formatMinor } from "@/server/sales/saleTotals";

/**
 * The sales trend â€” bars for takings, a line for bill count.
 *
 * Hand-drawn SVG rather than a charting library. The design reference uses one chart on one
 * screen, a charting package is a large client bundle to carry for that, and its default
 * axis and tooltip behaviour would have to be overridden almost entirely to match anyway.
 * What is left â€” a linear scale, a smoothed path and a hit-test â€” is arithmetic.
 *
 * Three decisions shape how it reads:
 *
 * Dead hours are trimmed. A shop trading 10:00â€“20:00 has fourteen empty columns, and drawing
 * them squeezes the real trading day into a third of the card while a flat line at zero
 * implies something was measured overnight. The window closes to the hours that actually
 * traded, one hour of air either side, and the axis labels still say exactly which hours
 * those are â€” so nothing is hidden, it is only not padded.
 *
 * The bill line is smoothed, because a straight segment between two equal counts draws a
 * plateau that reads as a sustained level rather than two separate hours.
 *
 * The line has no printed axis. It is on its own scale â€” bills are counted in tens, takings
 * in thousands â€” and the reference prints no second axis either. The exact figures come from
 * the tooltip on hover, and from the hidden table below for anyone not using a mouse.
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
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const WIDTH = 640;

/** A "nice" ceiling for the axis, so gridlines land on readable numbers rather than 43,712. */
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Close the window onto the hours that traded.
 *
 * One empty column is kept at each end so the first and last bars are not flush against the
 * axis. A range with no trade at all is returned untouched â€” the caller shows an empty state
 * rather than this chart, and trimming nothing to nothing would produce an empty axis.
 */
function trimToTrading(points: TrendChartPoint[]): TrendChartPoint[] {
  const first = points.findIndex((p) => p.billCount > 0 || p.salesMinor > 0);
  if (first === -1) return points;

  let last = points.length - 1;
  while (last > first && points[last]!.billCount === 0 && points[last]!.salesMinor === 0) {
    last -= 1;
  }

  return points.slice(Math.max(0, first - 1), Math.min(points.length, last + 2));
}

/**
 * A monotone cubic through the points.
 *
 * Monotone rather than a plain Catmull-Rom: an ordinary spline overshoots on the way out of a
 * flat run, so a quiet hour followed by a busy one would dip the line below zero bills before
 * climbing. Tangents are clamped to the segment slopes, which cannot overshoot.
 */
function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0]!.x},${coords[0]!.y}`;

  const slopes: number[] = [];
  for (let i = 0; i < coords.length - 1; i += 1) {
    const dx = coords[i + 1]!.x - coords[i]!.x;
    slopes.push(dx === 0 ? 0 : (coords[i + 1]!.y - coords[i]!.y) / dx);
  }

  const tangents: number[] = [slopes[0] ?? 0];
  for (let i = 1; i < coords.length - 1; i += 1) {
    const previous = slopes[i - 1]!;
    const next = slopes[i]!;
    // A turning point gets a flat tangent; that is what stops the overshoot.
    tangents.push(previous * next <= 0 ? 0 : (previous + next) / 2);
  }
  tangents.push(slopes[slopes.length - 1] ?? 0);

  let path = `M${coords[0]!.x.toFixed(1)},${coords[0]!.y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const dx = (b.x - a.x) / 3;
    path +=
      ` C${(a.x + dx).toFixed(1)},${(a.y + tangents[i]! * dx).toFixed(1)}` +
      ` ${(b.x - dx).toFixed(1)},${(b.y - tangents[i + 1]! * dx).toFixed(1)}` +
      ` ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return path;
}

export function TrendChart({ points, caption, height = 200 }: TrendChartProps) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  const visible = React.useMemo(() => trimToTrading(points), [points]);

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const maxSales = niceCeiling(Math.max(0, ...visible.map((p) => p.salesMinor)));
  const maxBills = Math.max(1, ...visible.map((p) => p.billCount));

  const slot = visible.length > 0 ? plotWidth / visible.length : plotWidth;
  const barWidth = Math.max(3, Math.min(20, slot * 0.5));

  const yFor = (value: number, max: number) =>
    max <= 0 ? PAD_TOP + plotHeight : PAD_TOP + plotHeight - (value / max) * plotHeight;
  const xFor = (index: number) => PAD_LEFT + slot * index + slot / 2;

  const gridValues = maxSales > 0 ? [0, 0.25, 0.5, 0.75, 1].map((f) => maxSales * f) : [0];
  const labelStride = Math.max(1, Math.ceil(visible.length / 12));

  const linePath = smoothPath(
    visible.map((point, index) => ({ x: xFor(index), y: yFor(point.billCount, maxBills) })),
  );

  const active = hovered === null ? null : visible[hovered];

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={caption}
        preserveAspectRatio="none"
        onMouseLeave={() => setHovered(null)}
      >
        {gridValues.map((value) => {
          const y = yFor(value, maxSales);
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 8}
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

        {visible.map((point, index) => {
          const y = yFor(point.salesMinor, maxSales);
          const barHeight = Math.max(0, PAD_TOP + plotHeight - y);
          return (
            <rect
              key={`bar-${point.label}`}
              x={xFor(index) - barWidth / 2}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill={hovered === index ? "#93c5fd" : "#bfdbfe"}
            />
          );
        })}

        {visible.length > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {active && (
          <circle
            cx={xFor(hovered!)}
            cy={yFor(active.billCount, maxBills)}
            r={3.5}
            fill="#fff"
            stroke="var(--color-primary)"
            strokeWidth={2}
          />
        )}

        {visible.map((point, index) =>
          index % labelStride === 0 ? (
            <text
              key={`label-${point.label}`}
              x={xFor(index)}
              y={height - 7}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-text-tertiary)"
            >
              {point.label}
            </text>
          ) : null,
        )}

        {/* Full-height hit targets, so a thin bar is still easy to hover. */}
        {visible.map((point, index) => (
          <rect
            key={`hit-${point.label}`}
            x={PAD_LEFT + slot * index}
            y={PAD_TOP}
            width={slot}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHovered(index)}
          />
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-border bg-background-card px-3 py-2 text-xs shadow-card"
          style={{ left: `${(xFor(hovered!) / WIDTH) * 100}%` }}
          role="presentation"
        >
          <p className="mb-1 font-semibold text-primary">{active.label}</p>
          <p className="flex items-center gap-1.5 text-secondary">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#bfdbfe]" />
            Sales: {formatMinor(active.salesMinor)}
          </p>
          <p className="flex items-center gap-1.5 text-secondary">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--color-primary)" }}
            />
            Bills: {active.billCount}
          </p>
        </div>
      )}

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

