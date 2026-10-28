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

/** Round a length to a whole number of printer dots. */
export function snapToDot(mm: number, dpi: PrinterDpi): number {
  return (Math.round((mm * dpi) / 25.4) * 25.4) / dpi;
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
      /**
       * Where the barcode (quiet zone included) starts, from the label's left edge: centred, then
       * snapped to a whole printer dot. Centring alone lands on a fractional dot, and 2-dot modules
       * then print 1 or 3 dots wide, which some codes can't survive at 203 dpi.
       */
      leftMm: number;
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
    leftMm: snapToDot((size.widthMm - totalWidthMm) / 2, dpi),
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
