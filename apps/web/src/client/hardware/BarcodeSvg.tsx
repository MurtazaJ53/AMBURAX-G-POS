"use client";

import { useMemo } from "react";
import { encodeCode128B } from "./code128Svg";

export function BarcodeSvg({
  value,
  height = 36,
  barWidth = 1.5,
  quietZone = 12,
  className = "w-full max-w-[200px] h-9 text-black",
}: {
  value: string;
  height?: number;
  barWidth?: number;
  /** Quiet zone padding in SVG pixels on left & right (standard >= 10px / 2mm) */
  quietZone?: number;
  className?: string;
}) {
  const { pathD, totalWidth } = useMemo(() => {
    if (!value) return { pathD: "", totalWidth: 100 };
    const binary = encodeCode128B(value);

    let d = "";
    // Start after the left quiet zone
    let x = quietZone;

    for (let i = 0; i < binary.length; i++) {
      if (binary[i] === "1") {
        d += `M${x},0h${barWidth}v${height}h-${barWidth}Z `;
      }
      x += barWidth;
    }

    // Include the right quiet zone
    const widthWithQuietZone = x + quietZone;

    return { pathD: d.trim(), totalWidth: widthWithQuietZone };
  }, [value, height, barWidth, quietZone]);

  if (!pathD) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalWidth} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      <path d={pathD} fill="currentColor" />
    </svg>
  );
}
