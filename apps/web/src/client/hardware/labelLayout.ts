import { encodeForLabel, quietZoneModules, type Symbology } from "./barcodeSymbology";

/**
 * Physical label geometry. Everything a printer sees is in millimetres and printer dots, never
 * CSS pixels: a thermal head prints whole dots, so a bar that is 1.4 or 2.6 dots wide comes out
 * uneven and a scanner misreads it. Each module (narrowest bar) is a fixed whole number of dots,
 * whatever the length of the code. A code too long to fit the label at that width is refused,
 * not shrunk.
 */

export type PrinterDpi = 203 | 300;
export type LabelSizeId = "roll-50x25" | "roll-38x25" | "a4-65";

export interface LabelSize {
  id: LabelSizeId;
  name: string;
  widthMm: number;
  heightMm: number;
  /** Inner margin on every side of the label, mm. */
  paddingMm: number;
  barHeightMm: number;
  /** A4 sheets carry no shop header: 21.2 mm has no room for it. */
  showStoreName: boolean;
  /** Roll: one label per printed page. Sheet: a grid on one page. */
  sheet: null | {
    pageWidthMm: number;
    pageHeightMm: number;
    columns: number;
    rows: number;
    marginTopMm: number;
    marginLeftMm: number;
    columnGapMm: number;
  };
}

export const LABEL_SIZES: Record<LabelSizeId, LabelSize> = {
  "roll-50x25": {
    id: "roll-50x25",
    name: "Roll 50 × 25 mm",
    widthMm: 50,
    heightMm: 25,
    paddingMm: 1.5,
    barHeightMm: 8,
    showStoreName: true,
    sheet: null,
  },
  "roll-38x25": {
    id: "roll-38x25",
    name: "Roll 38 × 25 mm",
    widthMm: 38,
    heightMm: 25,
    paddingMm: 1.2,
    barHeightMm: 8,
    showStoreName: true,
    sheet: null,
  },
  // The common A4 65-up sheet: 5 × 13 labels of 38.1 × 21.2 mm, 2.5 mm between columns.
  "a4-65": {
    id: "a4-65",
    name: "A4 sheet, 65 labels (38.1 × 21.2 mm)",
    widthMm: 38.1,
    heightMm: 21.2,
    paddingMm: 1,
    barHeightMm: 6.5,
    showStoreName: false,
    sheet: {
      pageWidthMm: 210,
      pageHeightMm: 297,
      columns: 5,
      rows: 13,
      marginTopMm: 10.7,
      marginLeftMm: 4.75,
      columnGapMm: 2.5,
    },
  },
};

/** Dots per module: 2 at 203 dpi (0.25 mm), 3 at 300 dpi (0.254 mm). */
export function dotsPerModule(dpi: PrinterDpi): number {
  return dpi === 300 ? 3 : 2;
}

export function moduleWidthMm(dpi: PrinterDpi): number {
  return (dotsPerModule(dpi) * 25.4) / dpi;
}

export type LabelBarcodeLayout =
  | {
      ok: true;
      symbology: Symbology;
      modules: string;
      quietZoneModules: number;
      moduleWidthMm: number;
      /** Bars plus both quiet zones. */
      totalWidthMm: number;
      dpi: PrinterDpi;
    }
  | { ok: false; reason: string };

export function layoutLabelBarcode(value: string, size: LabelSize, dpi: PrinterDpi): LabelBarcodeLayout {
  const encoded = encodeForLabel(value);
  if (!encoded.ok) return encoded;
  const quiet = quietZoneModules(encoded.symbology);
  const moduleMm = moduleWidthMm(dpi);
  const totalWidthMm = (encoded.modules.length + 2 * quiet) * moduleMm;
  const availableMm = size.widthMm - 2 * size.paddingMm;
  if (totalWidthMm > availableMm) {
    return {
      ok: false,
      reason: `Too long for a ${size.widthMm} mm label: needs ${totalWidthMm.toFixed(1)} mm, has ${availableMm.toFixed(1)} mm.`,
    };
  }
  return {
    ok: true,
    symbology: encoded.symbology,
    modules: encoded.modules,
    quietZoneModules: quiet,
    moduleWidthMm: moduleMm,
    totalWidthMm,
    dpi,
  };
}

/** CSS lays out in px of 1/96 inch; a browser snaps boxes to whole px when it prints. */
export const CSS_PX_PER_INCH = 96;

export function mmToPx(mm: number): number {
  return (mm * CSS_PX_PER_INCH) / 25.4;
}

/**
 * Where the barcode box starts inside its label, in whole CSS px from the label's left edge:
 * centred, rounded to a px so the browser has nothing left to snap. The bars inside are then
 * aligned to printer dots by barcodeBarsInDots.
 */
export function barcodeLeftPx(layout: Extract<LabelBarcodeLayout, { ok: true }>, size: LabelSize): number {
  return Math.round(mmToPx((size.widthMm - layout.totalWidthMm) / 2));
}

/**
 * The bars in printer dots, for a barcode box whose left edge sits at page x `boxLeftPx` (CSS px,
 * from the page's left edge). A px is 203/96 or 300/96 dots, never a whole number, so the box edge
 * falls between dots; `shiftDots` (0 to under 1) moves the bars to the next whole dot. Every bar
 * then starts and ends on a whole dot of the page, and every module is exactly dotsPerModule dots:
 * the printer never rounds a bar, so 2-dot modules can't come out 1 or 3 dots wide.
 */
export function barcodeBarsInDots(
  layout: Extract<LabelBarcodeLayout, { ok: true }>,
  boxLeftPx: number,
): { shiftDots: number; bars: Array<{ x: number; w: number }>; widthDots: number } {
  const perModule = dotsPerModule(layout.dpi);
  const leftDots = (boxLeftPx * layout.dpi) / CSS_PX_PER_INCH;
  // Tolerate float noise so an edge already on a dot isn't pushed a whole dot along.
  const shiftDots = Math.max(0, Math.ceil(leftDots - 1e-6) - leftDots);
  const bars: Array<{ x: number; w: number }> = [];
  let run = 0;
  for (let i = 0; i <= layout.modules.length; i++) {
    if (layout.modules[i] === "1") {
      run++;
    } else if (run > 0) {
      bars.push({ x: (layout.quietZoneModules + i - run) * perModule, w: run * perModule });
      run = 0;
    }
  }
  return { shiftDots, bars, widthDots: (layout.modules.length + 2 * layout.quietZoneModules) * perModule };
}

/**
 * Top-left corner of label `index` on its page, in whole CSS px. A roll label is its own page; an
 * A4 sheet's grid is placed by px rather than by CSS grid in mm, so each label's origin is known
 * exactly and its barcode can be aligned to printer dots.
 */
export function labelOriginPx(size: LabelSize, index: number): { x: number; y: number } {
  if (!size.sheet) return { x: 0, y: 0 };
  const col = index % size.sheet.columns;
  const row = Math.floor(index / size.sheet.columns);
  return {
    x: Math.round(mmToPx(size.sheet.marginLeftMm + col * (size.widthMm + size.sheet.columnGapMm))),
    y: Math.round(mmToPx(size.sheet.marginTopMm + row * size.heightMm)),
  };
}

/**
 * Height of one printed A4 sheet's box: the top margin plus the label rows, never the full page.
 * A box exactly as tall as the @page rounds up past it in the browser's pixel layout, and with
 * break-after that sliver becomes a blank page after every sheet.
 */
export function sheetBoxHeightMm(size: LabelSize): number {
  if (!size.sheet) return size.heightMm;
  const content = size.sheet.marginTopMm + size.sheet.rows * size.heightMm;
  return Math.min(content, size.sheet.pageHeightMm - 1);
}

/** The CSS @page rule for a print run on this label size. */
export function pageRule(size: LabelSize): string {
  return size.sheet
    ? `@page { size: ${size.sheet.pageWidthMm}mm ${size.sheet.pageHeightMm}mm; margin: 0; }`
    : `@page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }`;
}
