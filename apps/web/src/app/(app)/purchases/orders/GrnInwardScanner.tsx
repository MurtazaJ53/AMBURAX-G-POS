"use client";

import { useState } from "react";
import { Barcode, CheckCircle2, AlertCircle, Scan, Check } from "lucide-react";

export interface GrnLineItem {
  id: string;
  name: string;
  sku: string;
  due: number;
}

interface InwardScannerProps {
  lines: GrnLineItem[];
  onCountUpdate: (lineId: string, count: number) => void;
  counts: Record<string, number>;
}

export function GrnInwardScanner({ lines, onCountUpdate, counts }: InwardScannerProps) {
  const [scanInput, setScanInput] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function handleScan(rawBarcode: string) {
    const code = rawBarcode.trim();
    if (!code) return;

    // Match by SKU or barcode substring
    const matchedLine = lines.find(
      (l) => l.sku.toLowerCase() === code.toLowerCase() || code.toLowerCase().includes(l.sku.toLowerCase())
    );

    if (matchedLine) {
      const current = counts[matchedLine.id] ?? 0;
      if (current >= matchedLine.due) {
        setFeedback({
          message: `SKU ${matchedLine.sku} already fully counted (${current}/${matchedLine.due}).`,
          type: "error",
        });
      } else {
        const next = current + 1;
        onCountUpdate(matchedLine.id, next);
        setFeedback({
          message: `Scanned 1x ${matchedLine.sku} (${next}/${matchedLine.due})`,
          type: "success",
        });
      }
    } else {
      setFeedback({
        message: `No matching PO line found for barcode "${code}".`,
        type: "error",
      });
    }

    setScanInput("");
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 mb-4">
      <div className="flex items-center gap-2 text-xs font-bold text-sky-900 mb-2">
        <Scan className="h-4 w-4 text-sky-600" />
        <span>GRN Inward Barcode Scanner & Verification</span>
      </div>
      <p className="text-[11px] text-sky-700 mb-3">
        Scan incoming carton barcodes or product tags to tally units directly against order lines.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleScan(scanInput);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="Scan barcode or enter SKU and press Enter..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>
        <button
          type="submit"
          className="px-3.5 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 transition-colors shadow-sm cursor-pointer"
        >
          Verify
        </button>
      </form>

      {feedback && (
        <div
          className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
            feedback.type === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
