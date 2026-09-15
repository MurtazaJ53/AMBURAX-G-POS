/**
 * Order money and quantity arithmetic. Integer only, no database, no rounding.
 *
 * ## Why this is not `saleTotals.ts`
 *
 * A sale's totals carry tax and discount, because a sale is a completed transaction that had to
 * settle to the rupee at the till — `computeSaleTotals` even extracts tax out of an inclusive
 * price. An order in this phase carries neither: no second tax engine, no second discount
 * engine. Reusing the sale calculation would mean pushing zeros through machinery built for a
 * different question, and inviting someone to "just add" a rate later in the wrong place. The
 * sale calculation is untouched and remains the authority for sales.
 *
 * ## Tax and discount are deliberately excluded
 *
 * An order's subtotal is the sum of its lines and nothing else. There is no `totalMinor`,
 * because with tax and discount out of scope it would be identical to the subtotal, and a field
 * that means nothing yet is a field code starts trusting. When tax and discount arrive, a total
 * arrives with them.
 *
 * ## Money
 *
 * Integer minor units throughout, as everywhere else in this system. No floats, no decimals, no
 * currency conversion. `unitPriceMinor` always comes from the P1-8E pricing service; nothing
 * here accepts a price from a caller.
 */

export type OrderQuantityError = "not_an_integer" | "not_positive" | "too_large";

/**
 * A ceiling on one line's quantity. Not a business rule about how much anyone may buy — it is
 * where a plausible order stops and a typo or an overflow attempt starts, and it keeps
 * `quantity * unitPriceMinor` far inside a 32-bit integer column.
 */
export const MAX_ORDER_LINE_QUANTITY = 1_000_000;

/** The same integer contract as P1-8C: quantities are whole and positive. */
export function validateOrderQuantity(quantity: unknown): OrderQuantityError | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return "not_an_integer";
  }
  if (quantity <= 0) return "not_positive";
  if (quantity > MAX_ORDER_LINE_QUANTITY) return "too_large";
  return null;
}

export type OrderMoneyError = "not_an_integer" | "negative" | "too_large";

/** Ten lakh rupees for one unit, matching the pricing service's own ceiling. */
export const MAX_ORDER_UNIT_PRICE_MINOR = 100_000_000;

/**
 * Money is integer minor units. Zero is allowed, because P1-8E allows a zero price and an order
 * line must be able to carry the price the pricing service actually resolved. Negative is not:
 * a negative line is a refund, and refunds are not orders.
 */
export function validateOrderUnitPrice(unitPriceMinor: unknown): OrderMoneyError | null {
  if (
    typeof unitPriceMinor !== "number" ||
    !Number.isFinite(unitPriceMinor) ||
    !Number.isInteger(unitPriceMinor)
  ) {
    return "not_an_integer";
  }
  if (unitPriceMinor < 0) return "negative";
  if (unitPriceMinor > MAX_ORDER_UNIT_PRICE_MINOR) return "too_large";
  return null;
}

/** One line's money. Exact by construction — two integers multiplied, nothing rounded. */
export function computeLineTotalMinor(quantity: number, unitPriceMinor: number): number {
  return quantity * unitPriceMinor;
}

/** The order's subtotal, which in this phase is the whole of its value. */
export function computeSubtotalMinor(lines: readonly { lineTotalMinor: number }[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
}

export type FulfilQuantityError = "not_an_integer" | "not_positive" | "exceeds_ordered";

/**
 * How much may still be recorded against a line.
 *
 * Over-fulfilment is refused rather than clamped. Delivering more than was ordered is a real
 * event in a warehouse, but it is not a fact this document can absorb silently — the order says
 * what was agreed, and quietly raising it would erase a disagreement someone needs to see.
 */
export function validateFulfilQuantity(
  quantity: unknown,
  alreadyFulfilled: number,
  ordered: number,
): FulfilQuantityError | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return "not_an_integer";
  }
  if (quantity <= 0) return "not_positive";
  if (alreadyFulfilled + quantity > ordered) return "exceeds_ordered";
  return null;
}
