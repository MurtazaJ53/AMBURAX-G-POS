"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Barcode, Printer, X, Plus, Minus } from "lucide-react";
import {
  LABEL_SIZES,
  layoutLabelBarcode,
  pageRule,
  type LabelBarcodeLayout,
  type LabelSize,
  type LabelSizeId,
  type PrinterDpi,
} from "@/client/hardware/labelLayout";

export interface PrintableVariantItem {
  id: string;
  sku: string;
  barcode: string | null;
  productName: string;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor?: number | null;
  /** Quantity to print. Default: 1 (or purchase receipt quantity) */
  quantity?: number;
}

const PRINTER_PREFS_KEY = "amb.labelPrinter";
const PREVIEW_LIMIT = 24;

/** Per-device printer choice. Browser storage may be unavailable; the defaults then apply. */
function readPrinterPrefs(): { sizeId: LabelSizeId; dpi: PrinterDpi } | null {
  try {
    const raw = window.localStorage.getItem(PRINTER_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sizeId?: string; dpi?: number };
    const sizeId = parsed.sizeId && parsed.sizeId in LABEL_SIZES ? (parsed.sizeId as LabelSizeId) : "roll-50x25";
    const dpi: PrinterDpi = parsed.dpi === 300 ? 300 : 203;
    return { sizeId, dpi };
  } catch {
    return null;
  }
}

function writePrinterPrefs(prefs: { sizeId: LabelSizeId; dpi: PrinterDpi }) {
  try {
    window.localStorage.setItem(PRINTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered on this device; printing still works.
  }
}

/**
 * Bars drawn in modules, sized in millimetres. One module is a whole number of printer dots
 * (see labelLayout), so the printer never has to round a bar.
 */
function LabelBarcodeSvg({ layout, heightMm }: { layout: Extract<LabelBarcodeLayout, { ok: true }>; heightMm: number }) {
  const rects: Array<{ x: number; w: number }> = [];
  let x = layout.quietZoneModules;
  let run = 0;
  for (let i = 0; i <= layout.modules.length; i++) {
    if (layout.modules[i] === "1") {
      run++;
    } else if (run > 0) {
      rects.push({ x: x - run, w: run });
      run = 0;
    }
    x++;
  }
  const totalModules = layout.modules.length + 2 * layout.quietZoneModules;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalModules} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: `${layout.totalWidthMm}mm`, height: `${heightMm}mm`, display: "block" }}
      aria-hidden="true"
    >
      {rects.map((r) => (
        <rect key={r.x} x={r.x} y={0} width={r.w} height={1} fill="#000" />
      ))}
    </svg>
  );
}

/** Exported for rendering sample labels outside the modal; the modal is its only app caller. */
export function LabelSticker(props: {
  item: PrintableVariantItem;
  code: string;
  layout: Extract<LabelBarcodeLayout, { ok: true }>;
  size: LabelSize;
  storeName?: string;
  includeStoreName: boolean;
  includeMrp: boolean;
}) {
  const { item: v, size } = props;
  const line: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.15 };
  const variantText = [v.size ? `SIZE: ${v.size}` : null, v.colour].filter(Boolean).join(" | ");
  const showStore = props.includeStoreName && size.showStoreName && Boolean(props.storeName);
  return (
    <div
      className="amb-label"
      style={{
        width: `${size.widthMm}mm`,
        height: `${size.heightMm}mm`,
        padding: `${size.paddingMm}mm`,
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "center",
        color: "#000",
        background: "#fff",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {showStore && (
        <div style={{ ...line, width: "100%", fontSize: "6.5pt", fontWeight: 800, textTransform: "uppercase" }}>
          {props.storeName}
        </div>
      )}
      <div style={{ width: "100%" }}>
        <div style={{ ...line, fontSize: "7pt", fontWeight: 700, textTransform: "uppercase" }}>{v.productName}</div>
        {variantText && <div style={{ ...line, fontSize: "6pt", fontWeight: 600 }}>{variantText}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <LabelBarcodeSvg layout={props.layout} heightMm={size.barHeightMm} />
        <div style={{ fontFamily: "monospace", fontSize: "6.5pt", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.1 }}>
          {props.code}
        </div>
      </div>
      {props.includeMrp && (
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: "7pt", fontWeight: 800, lineHeight: 1.1 }}>
          {v.mrpMinor != null && v.mrpMinor > v.priceMinor ? (
            <>
              <span style={{ fontSize: "6pt", fontWeight: 500, textDecoration: "line-through" }}>
                MRP ₹{(v.mrpMinor / 100).toFixed(0)}
              </span>
              <span>₹{(v.priceMinor / 100).toFixed(0)}</span>
            </>
          ) : (
            <span style={{ width: "100%" }}>MRP ₹{(v.priceMinor / 100).toFixed(0)}</span>
          )}
        </div>
      )}
    </div>
  );
}

interface PrintableLabel {
  item: PrintableVariantItem;
  code: string;
  layout: Extract<LabelBarcodeLayout, { ok: true }>;
}

export function BarcodeLabelModal(props: {
  isOpen: boolean;
  onClose: () => void;
  variants: PrintableVariantItem[];
  storeName?: string;
  title?: string;
}) {
  // Store printing quantities per variant
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const v of props.variants) {
      init[v.id] = v.quantity && v.quantity > 0 ? v.quantity : 1;
    }
    return init;
  });

  const [includeStoreName, setIncludeStoreName] = useState(true);
  const [includeMrp, setIncludeMrp] = useState(true);
  const [sizeId, setSizeId] = useState<LabelSizeId>("roll-50x25");
  const [dpi, setDpi] = useState<PrinterDpi>(203);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prefs = readPrinterPrefs();
    if (prefs) {
      setSizeId(prefs.sizeId);
      setDpi(prefs.dpi);
    }
  }, []);

  // While this modal is open, printing prints the label sheet and nothing else on the page.
  useEffect(() => {
    if (!props.isOpen) return;
    document.body.classList.add("amb-printing-labels");
    return () => document.body.classList.remove("amb-printing-labels");
  }, [props.isOpen]);

  const size = LABEL_SIZES[sizeId];

  // The barcode each variant prints, or why it cannot print on this label size.
  const layouts = useMemo(() => {
    const map = new Map<string, { code: string; layout: LabelBarcodeLayout }>();
    for (const v of props.variants) {
      const code = (v.barcode || v.sku).trim();
      map.set(v.id, { code, layout: layoutLabelBarcode(code, size, dpi) });
    }
    return map;
  }, [props.variants, size, dpi]);

  const printable = useMemo(() => {
    const labels: PrintableLabel[] = [];
    for (const v of props.variants) {
      const entry = layouts.get(v.id);
      if (!entry || !entry.layout.ok) continue;
      const count = quantities[v.id] ?? 0;
      for (let i = 0; i < count; i++) labels.push({ item: v, code: entry.code, layout: entry.layout });
    }
    return labels;
  }, [props.variants, quantities, layouts]);

  const refused = props.variants.filter((v) => {
    const entry = layouts.get(v.id);
    return entry && !entry.layout.ok && (quantities[v.id] ?? 0) > 0;
  });

  if (!props.isOpen || props.variants.length === 0) return null;

  function updateQty(id: string, qty: number) {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, Math.min(500, qty)),
    }));
  }

  function setAllQty(qty: number) {
    const next: Record<string, number> = {};
    for (const v of props.variants) {
      next[v.id] = qty;
    }
    setQuantities(next);
  }

  function choosePrinter(next: { sizeId: LabelSizeId; dpi: PrinterDpi }) {
    setSizeId(next.sizeId);
    setDpi(next.dpi);
    writePrinterPrefs(next);
  }

  const sticker = (label: PrintableLabel, key: string) => (
    <LabelSticker
      key={key}
      item={label.item}
      code={label.code}
      layout={label.layout}
      size={size}
      storeName={props.storeName}
      includeStoreName={includeStoreName}
      includeMrp={includeMrp}
    />
  );

  // Rolls print one label per page; an A4 sheet prints up to 65 per page in its fixed grid.
  const sheet = size.sheet;
  const perPage = sheet ? sheet.columns * sheet.rows : 1;
  const pages: PrintableLabel[][] = [];
  for (let i = 0; i < printable.length; i += perPage) pages.push(printable.slice(i, i + perPage));

  const printRoot =
    mounted &&
    createPortal(
      <div className="amb-label-print-root">
        <style>{pageRule(size)}</style>
        {pages.map((page, pageIdx) => (
          <div
            key={pageIdx}
            className="amb-label-page"
            style={
              sheet
                ? {
                    width: `${sheet.pageWidthMm}mm`,
                    height: `${sheet.pageHeightMm}mm`,
                    boxSizing: "border-box",
                    paddingTop: `${sheet.marginTopMm}mm`,
                    paddingLeft: `${sheet.marginLeftMm}mm`,
                    display: "grid",
                    gridTemplateColumns: `repeat(${sheet.columns}, ${size.widthMm}mm)`,
                    gridAutoRows: `${size.heightMm}mm`,
                    columnGap: `${sheet.columnGapMm}mm`,
                    alignContent: "start",
                  }
                : { width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }
            }
          >
            {page.map((label, idx) => sticker(label, `${pageIdx}-${idx}`))}
          </div>
        ))}
      </div>,
      document.body,
    );

  return (
    <>
      {printRoot}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm"
      >
        <div className="amb-pop-in relative flex max-h-[94vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Barcode className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {props.title || "Print barcode labels"}
                </h3>
                <p className="text-xs text-slate-500">
                  Pick the label size and printer resolution that match your printer, then print.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="border-b border-slate-100 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span>Label size:</span>
                  <select
                    value={sizeId}
                    onChange={(e) => choosePrinter({ sizeId: e.target.value as LabelSizeId, dpi })}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    {Object.values(LABEL_SIZES).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span>Printer:</span>
                  <select
                    value={dpi}
                    onChange={(e) => choosePrinter({ sizeId, dpi: e.target.value === "300" ? 300 : 203 })}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value={203}>203 dpi (most thermal printers)</option>
                    <option value={300}>300 dpi</option>
                  </select>
                </label>

                {size.showStoreName && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                    <input
                      type="checkbox"
                      checked={includeStoreName}
                      onChange={(e) => setIncludeStoreName(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Store name</span>
                  </label>
                )}

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeMrp}
                    onChange={(e) => setIncludeMrp(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>MRP &amp; selling price</span>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-600">
                  Total: <strong className="text-indigo-600">{printable.length}</strong> labels
                </span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={printable.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  <span>Print labels</span>
                </button>
              </div>
            </div>

            {refused.length > 0 && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {refused.length === 1 ? "1 item" : `${refused.length} items`} will not print on this label size:
                  </p>
                  <ul className="mt-0.5 list-disc pl-4">
                    {refused.map((v) => {
                      const entry = layouts.get(v.id);
                      return (
                        <li key={v.id}>
                          {v.productName} [{entry?.code}]: {entry && !entry.layout.ok ? entry.layout.reason : ""}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-0.5">Give these items a shorter barcode, or choose a wider label.</p>
                </div>
              </div>
            )}

            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex items-center justify-between px-2 pb-1.5 border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <span>Item / Variant</span>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setAllQty(1)} className="text-xs text-indigo-600 hover:underline">
                    Set all to 1
                  </button>
                  <button type="button" onClick={() => setAllQty(5)} className="text-xs text-indigo-600 hover:underline">
                    Set all to 5
                  </button>
                  <span>Labels to print</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {props.variants.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-1.5 px-2">
                    <div className="truncate pr-4">
                      <span className="font-semibold text-slate-900">{v.productName}</span>{" "}
                      <span className="text-slate-500">
                        {[v.size ? `Size: ${v.size}` : null, v.colour].filter(Boolean).join(" · ") || v.sku}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-slate-400">[{v.barcode || v.sku}]</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        aria-label={`One fewer label for ${v.productName}`}
                        onClick={() => updateQty(v.id, (quantities[v.id] ?? 0) - 1)}
                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        aria-label={`Labels to print for ${v.productName}`}
                        value={quantities[v.id] ?? 0}
                        onChange={(e) => updateQty(v.id, parseInt(e.target.value, 10) || 0)}
                        className="h-6 w-14 rounded border border-slate-300 text-center font-bold text-slate-900 focus:border-indigo-500 focus:outline-none text-xs"
                      />
                      <button
                        type="button"
                        aria-label={`One more label for ${v.productName}`}
                        onClick={() => updateQty(v.id, (quantities[v.id] ?? 0) + 1)}
                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-100/70 p-4 sm:p-6">
            {printable.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                No labels to print. Increase a quantity above.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap justify-center gap-3">
                  {printable.slice(0, PREVIEW_LIMIT).map((label, idx) => (
                    <div key={`${label.item.id}-${idx}`} className="border border-dashed border-slate-400 shadow-xs">
                      {sticker(label, "preview")}
                    </div>
                  ))}
                </div>
                {printable.length > PREVIEW_LIMIT && (
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Showing {PREVIEW_LIMIT} of {printable.length} labels. All of them print.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 p-4">
            <span className="text-xs text-slate-500">
              {sheet ? "One A4 page per 65 labels." : `One label per page, ${size.widthMm} × ${size.heightMm} mm.`} In the
              print dialog, set scale to 100% and margins to none.
            </span>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
