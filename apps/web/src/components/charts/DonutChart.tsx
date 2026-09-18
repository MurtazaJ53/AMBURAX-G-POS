import * as React from "react";

/**
 * A donut for the payment split.
 *
 * Arcs are drawn with `stroke-dasharray` on concentric circles rather than with path
 * arithmetic: one circle per slice, each dashed to its own share and rotated to start where
 * the last one finished. It is less code than computing arc endpoints, and it degrades
 * correctly when a single method accounts for the whole day — the case that breaks a naive
 * arc path, because a 360-degree arc has identical start and end points and renders as
 * nothing at all.
 *
 * A server component: it holds no state and takes no interaction, so there is no reason to
 * ship it to the browser.
 */

export interface DonutSlice {
  key: string;
  label: string;
  /** 0-100. Null means the total was zero, and the caller should not render the donut at all. */
  sharePct: number | null;
  colour: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  /** Sits in the hole — the day's total, usually. */
  centreLabel: string;
  centreCaption: string;
  size?: number;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({ slices, centreLabel, centreCaption, size = 132 }: DonutChartProps) {
  // Each slice's rotation is the sum of every share before it. Computed up front rather than
  // accumulated inside the map: mutating a variable while rendering is a hazard React's
  // linting rightly refuses, and a running total is exactly the kind of state that would
  // survive into a re-render and put the second paint's arcs in the wrong places.
  const rotations = slices.reduce<number[]>((acc, slice, index) => {
    const previous = index === 0 ? 0 : acc[index - 1]! + (slices[index - 1]!.sharePct ?? 0);
    acc.push(previous);
    void slice;
    return acc;
  }, []);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={`${centreCaption}: ${slices
          .map((slice) => `${slice.label} ${slice.sharePct ?? 0}%`)
          .join(", ")}`}
      >
        <circle
          cx={60}
          cy={60}
          r={RADIUS}
          fill="none"
          stroke="var(--color-bg-active)"
          strokeWidth={16}
        />
        {slices.map((slice, index) => {
          const share = slice.sharePct ?? 0;
          const dash = (share / 100) * CIRCUMFERENCE;
          // -90deg puts the first slice at twelve o'clock, which is where a reader looks first.
          const rotation = -90 + (rotations[index]! / 100) * 360;
          return (
            <circle
              key={slice.key}
              cx={60}
              cy={60}
              r={RADIUS}
              fill="none"
              stroke={slice.colour}
              strokeWidth={16}
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              transform={`rotate(${rotation} 60 60)`}
            >
              <title>{`${slice.label}: ${share}%`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute text-center">
        <p className="text-sm font-bold text-primary">{centreLabel}</p>
        <p className="text-[10px] text-tertiary">{centreCaption}</p>
      </div>
    </div>
  );
}
