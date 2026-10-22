/**
 * Authoritative money arithmetic for a sale.
 *
 * Pure functions over integers, deliberately: **the browser's numbers are never used.**
 * The client sends variant ids and quantities; every price, tax and total in a persisted
 * sale is computed here from the variant row the server read. A client that posts
 * `total: 1` gets a sale for the real amount, not for one paisa.
 *
 * Everything is in **minor units** (paise) and **basis points** (1800 = 18.00%). No float
 * touches money at any point. `0.1 + 0.2 !== 0.3` in binary floating point, and a till that
 * accumulates that error across a day's takings produces a figure that reconciles to
 * nothing — the kind of defect discovered in an audit rather than in testing.
 *
 * Tax model, stated plainly: prices are treated as **tax-inclusive** (the MRP convention
 * this product targets), so tax is extracted from the line rather than added to it. ERPNext
 * remains authoritative for the tax *posting*; this computes what the customer is charged
 * at the counter. See ADR-081.
 */

/** A line as the server understands it, after the variant has been read from the database. */
export interface PricedLine {
  variantId: string;
  quantity: number;
  /** Copied from the variant row. Never from the request. */
  unitPriceMinor: number;
  /** Copied from the variant row. Never from the request. */
  taxRateBp: number;
  /** APPAREL_SLAB lines take their rate from the slab at sale time; FIXED (default) use taxRateBp. */
  taxRateMode?: "FIXED" | "APPAREL_SLAB";
}

export interface ComputedLine extends PricedLine {
  /** quantity x unitPrice, tax-inclusive. */
  lineTotalMinor: number;
  /** The tax component contained within `lineTotalMinor`. */
  taxMinor: number;
  lineDiscountMinor: number;
}

export interface SaleTotals {
  lines: ComputedLine[];
  /** Sum of tax-inclusive line totals before any discount. */
  grossMinor: number;
  /** Taxable value: totalMinor less the GST it contains. */
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  /** What the customer pays: tax-inclusive line totals, less discount. */
  totalMinor: number;
}

export const MAX_LINE_QUANTITY = 9_999;
export const MAX_LINES_PER_SALE = 200;

export type QuantityError = "not_an_integer" | "not_positive" | "too_large";

/**
 * Quantity is validated rather than coerced. A fractional or negative quantity is a bug or
 * an attack, not something to silently round: `Math.floor(-1)` would quietly credit the
 * customer, and a NaN would poison every total downstream.
 */
export function validateQuantity(quantity: unknown): QuantityError | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return "not_an_integer";
  }
  if (quantity <= 0) return "not_positive";
  if (quantity > MAX_LINE_QUANTITY) return "too_large";
  return null;
}

/**
 * Extract the tax contained in a tax-inclusive amount.
 *
 * `tax = gross - gross / (1 + rate)`, computed in integers:
 *   tax = round(gross * rateBp / (10000 + rateBp))
 *
 * Rounded per line rather than once at the end, because the line is what a customer checks
 * against a printed receipt — a single whole-sale rounding can leave individual lines that
 * visibly do not add up.
 */
export function taxFromInclusive(grossMinor: number, taxRateBp: number): number {
  if (taxRateBp <= 0 || grossMinor === 0) return 0;
  return Math.round((grossMinor * taxRateBp) / (10_000 + taxRateBp));
}

/**
 * The garment GST slab (owner decision 2026-10-13): the low rate when the value of one piece,
 * excluding GST at the low rate, is at or below the threshold; the high rate above it.
 */
export interface ApparelSlab {
  thresholdMinor: number;
  lowRateBp: number;
  highRateBp: number;
}

/**
 * The slab rate for a line, from what the customer actually pays for it (after discount).
 *
 * Integer-only: "net / qty / (1 + low) <= threshold" is rearranged to
 * `net * 10000 <= threshold * qty * (10000 + low)` so no fraction of a paisa is ever rounded
 * into or out of the slab.
 */
export function apparelSlabRateBp(netLineMinor: number, quantity: number, slab: ApparelSlab): number {
  const withinLow = netLineMinor * 10_000 <= slab.thresholdMinor * quantity * (10_000 + slab.lowRateBp);
  return withinLow ? slab.lowRateBp : slab.highRateBp;
}

/**
 * Spread a bill discount over its lines in proportion to each line's value, using largest
 * remainders so the parts always add up to the whole, to the paisa.
 */
export function allocateDiscount(lineTotals: number[], discountMinor: number): number[] {
  const gross = lineTotals.reduce((a, b) => a + b, 0);
  if (discountMinor <= 0 || gross <= 0) return lineTotals.map(() => 0);
  const exact = lineTotals.map((t) => (t * discountMinor) / gross);
  const parts = exact.map((e) => Math.floor(e));
  let left = discountMinor - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
}

/**
 * Compute every amount for a sale.
 *
 * `discountMinor` is a whole-sale discount entered by the operator. It is clamped to the
 * sale total: a discount larger than the bill would produce a negative total, which is a
 * refund — a different transaction with different accounting, not something the checkout
 * path should be able to create by accident.
 *
 * The discount is allocated across lines, and each line's GST is extracted from what the
 * customer pays for it after discount: a discount lowers the taxable value. A line whose
 * variant uses the garment slab takes its rate from that discounted per-piece value.
 */
export function computeSaleTotals(
  lines: PricedLine[],
  discountMinor = 0,
  slab: ApparelSlab | null = null,
): SaleTotals {
  const lineTotals = lines.map((line) => line.unitPriceMinor * line.quantity);
  const grossMinor = lineTotals.reduce((sum, t) => sum + t, 0);
  const discount = Math.max(0, Math.min(Math.round(discountMinor), grossMinor));
  const shares = allocateDiscount(lineTotals, discount);

  const computed: ComputedLine[] = lines.map((line, i) => {
    const lineTotalMinor = lineTotals[i]!;
    const lineDiscountMinor = shares[i]!;
    const netMinor = lineTotalMinor - lineDiscountMinor;
    const taxRateBp =
      line.taxRateMode === "APPAREL_SLAB" && slab
        ? apparelSlabRateBp(netMinor, line.quantity, slab)
        : line.taxRateBp;
    return {
      ...line,
      taxRateBp,
      lineTotalMinor,
      lineDiscountMinor,
      taxMinor: taxFromInclusive(netMinor, taxRateBp),
    };
  });

  const taxMinor = computed.reduce((sum, l) => sum + l.taxMinor, 0);
  const totalMinor = grossMinor - discount;

  return {
    lines: computed,
    grossMinor,
    // The taxable value: what the customer pays, net of the GST it contains. With no discount
    // this is gross minus tax, exactly as before.
    subtotalMinor: totalMinor - taxMinor,
    discountMinor: discount,
    taxMinor,
    totalMinor,
  };
}

/** Display helper. Kept beside the arithmetic so the two cannot drift apart. */
export function formatMinor(minor: number, currency = "INR"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, "0");
  return `${sign}${currency === "INR" ? "₹" : ""}${major.toLocaleString("en-IN")}.${paise}`;
}
