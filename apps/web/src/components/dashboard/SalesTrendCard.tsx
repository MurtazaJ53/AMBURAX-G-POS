"use client";

import * as React from "react";
import { TREND_RANGES, formatAxisMoney, type TrendRange } from "@/server/dashboard/dashboardTransforms";
import { cn } from "@/lib/utils";

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


import { formatMinor } from "@/server/sales/saleTotals";

function SalesChart({ data }: { data: TrendPointDto[] }) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  if (!data.length || data.every(d => d.salesMinor === 0 && d.billCount === 0)) {
    return <div className="flex h-[205px] items-center justify-center px-4 pb-3 text-center text-xs text-slate-400">Sales trend data is unavailable for this period.</div>;
  }

  let filteredData = data;
  if (data.length === 24) {
    const firstNonZero = data.findIndex(d => d.salesMinor > 0 || d.billCount > 0);
    const lastNonZero = data.findLastIndex(d => d.salesMinor > 0 || d.billCount > 0);
    if (firstNonZero !== -1) {
      let start = Math.max(0, firstNonZero - 1);
      let end = Math.min(23, lastNonZero + 1);
      while (end - start < 5 && (start > 0 || end < 23)) {
        if (start > 0) start--;
        if (end < 23) end++;
      }
      filteredData = data.slice(start, end + 1);
    }
  }

  const maxMinor = Math.max(...filteredData.map((point) => point.salesMinor));
  const maxSales = maxMinor / 100;
  const tickMax = Math.ceil(maxSales / 10) * 10 || 10;
  const maxBills = Math.max(...filteredData.map((point) => point.billCount)) || 1;
  
  const width = 630;
  const height = 188;
  const count = Math.max(1, filteredData.length - 1);
  const pointsBills = filteredData.map((point, index) => `${(index / count) * width},${height - 16 - ((point.billCount / maxBills) * 136)}`).join(' ');
  
  return (
    <div className="px-4 pb-3 relative">
      <div className="relative h-[205px] w-full">
        <div className="absolute inset-x-0 top-2 bottom-6 flex flex-col justify-between text-[9px] text-slate-400">
          {[tickMax, tickMax*0.75, tickMax*0.5, tickMax*0.25, 0].map((tick, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-9 text-right font-mono">{formatAxisMoney(Math.round(tick * 100))}</span>
              <span className="h-px flex-1 border-t border-dashed border-slate-200" />
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute left-8 right-4 top-2 h-[177px] w-[calc(100%-48px)] overflow-visible">
          {filteredData.map((point, index) => {
             const x = (index / count) * width;
             const h = maxSales ? ((point.salesMinor / 100) / maxSales) * 136 : 0;
             return <rect key={`bar-${index}`} x={x - 6} y={height - 16 - h} width={12} height={h} fill="#38bdf8" rx="2" className="transition-all" opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.4} />
          })}
          
          <polyline points={pointsBills} fill="none" stroke="#a78bfa" strokeWidth="2.5" className="chart-line" vectorEffect="non-scaling-stroke" />
          {filteredData.map((point, index) => {
             const x = (index / count) * width;
             const y = height - 16 - ((point.billCount / maxBills) * 136);
             return <circle key={`dot-${index}`} cx={x} cy={y} r="4" fill="#fff" stroke="#a78bfa" strokeWidth="2" className="transition-all" opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.4} />
          })}

          {filteredData.map((point, index) => {
             const x = (index / count) * width;
             const segmentWidth = width / count;
             return (
               <rect 
                  key={`hover-${index}`} 
                  x={x - (segmentWidth / 2)} 
                  y={0} 
                  width={segmentWidth} 
                  height={height} 
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onTouchStart={() => setHoverIndex(index)}
               />
             );
          })}
        </svg>

        <div className="absolute left-8 right-4 bottom-0 h-4">
          {filteredData.map((point, index) => {
             const x = (index / count) * 100;
             let show = true;
             if (filteredData.length > 15) show = index % 3 === 0;
             else if (filteredData.length > 8) show = index % 2 === 0;
             
             return (
               <div 
                 key={index} 
                 className={`absolute text-center -ml-[20px] w-[40px] text-[9px] font-medium ${show ? 'text-slate-500' : 'text-transparent sm:text-slate-500'}`} 
                 style={{ left: `${x}%` }}
               >
                 {point.label}
               </div>
             );
          })}
        </div>
      </div>
      
      <div className="flex items-center gap-4 pl-8 pt-1 text-[10px] text-slate-500">
        <span className="flex items-center"><i className="inline-block size-2 rounded-full bg-sky-400 mr-1.5" /> Sales</span>
        <span className="flex items-center"><i className="inline-block size-2 rounded-full bg-violet-400 mr-1.5" /> Bills</span>
      </div>

      {hoverIndex !== null && filteredData[hoverIndex] && (
        <div 
          className="absolute z-20 bg-slate-800 text-white text-[10px] p-2.5 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all"
          style={{ 
            left: `calc(2rem + ${(hoverIndex / count) * (100 - (48/630*100))}%) `,
            top: 'calc(100% - 40px)',
          }}
        >
          <div className="font-bold mb-1.5 text-slate-200 border-b border-slate-600 pb-1">{filteredData[hoverIndex]!.label}</div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-sky-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Sales:</span> 
            <span className="font-semibold font-mono">{formatMinor(filteredData[hoverIndex]!.salesMinor)}</span>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap mt-1">
            <span className="size-2 rounded-full bg-violet-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Bills:</span> 
            <span className="font-semibold font-mono">{filteredData[hoverIndex]!.billCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
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

  return (
    <div className="surface-card overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-bold text-slate-800">Sales trend</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Live movement across the selected period</p>
        </div>
        <div className="flex items-center rounded-md bg-slate-100 p-0.5">
          {TREND_RANGES.map((option) => {
            const active = option.id === range;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void selectRange(option.id)}
                className={cn(
                  "rounded px-2 py-1.5 text-[10px] font-semibold transition",
                  active ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      
      {state === "error" ? (
        <div className="flex h-[205px] flex-col items-center justify-center px-4 py-8 text-center bg-rose-50/50">
          <p className="text-sm font-medium text-rose-600">The trend didn&apos;t load</p>
          <button
            type="button"
            onClick={() => void selectRange(range)}
            className="mt-4 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      ) : state === "loading" ? (
        <div className="flex h-[245px] items-center justify-center animate-pulse bg-slate-50/50" />
      ) : (
        <SalesChart data={points} />
      )}
    </div>
  );
}
