/**
 * Choosing a price from a list's items. Pure comparison and arithmetic, no database.
 *
 * Two rules, and they are the whole of it:
 *
 * 1. **Validity.** An item applies at an instant when `validFrom` is null or has passed, and
 *    `validTo` is null or has not. Both null — the ordinary case — means "always".
 * 2. **Quantity break.** Among the items that apply, take the one with the **highest
 *    `minQuantity` that does not exceed the quantity asked for**.
 *
 *        breaks at 1, 10 and 50:
 *        quantity  1 -> the 1 break
 *        quantity  9 -> the 1 break
 *        quantity 10 -> the 10 break
 *        quantity 49 -> the 10 break
 *        quantity 50 -> the 50 break
 *
 * No separate quantity-break table: a break is another row with a different `minQuantity`, which
 * is why the unique key includes it.
 *
 * What this deliberately is not: a discount engine. Nothing here stacks, combines, applies a
 * percentage or reasons about campaigns. It picks one row.
 */

export interface PricedItem {
  id: string;
  minQuantity: number;
  unitPriceMinor: number;
  validFrom: Date | null;
  validTo: Date | null;
}

/**
 * Is this item in force at `at`?
 *
 * Inclusive at both ends. A price valid "from today" applies today and one valid "to the 31st"
 * applies on the 31st — that is what a person writing those dates means, and the alternative
 * silently loses a day at each end.
 */
export function isWithinWindow(item: Pick<PricedItem, "validFrom" | "validTo">, at: Date): boolean {
  if (item.validFrom && at.getTime() < item.validFrom.getTime()) return false;
  if (item.validTo && at.getTime() > item.validTo.getTime()) return false;
  return true;
}

/** `validFrom <= validTo` when both are given. A window that ends before it starts is a typo. */
export function isWindowCoherent(validFrom: Date | null, validTo: Date | null): boolean {
  if (!validFrom || !validTo) return true;
  return validFrom.getTime() <= validTo.getTime();
}

/** Do two windows share any instant? Used to refuse a second price for the same break. */
export function windowsOverlap(
  a: { validFrom: Date | null; validTo: Date | null },
  b: { validFrom: Date | null; validTo: Date | null },
): boolean {
  // An open end is infinity in that direction, so an unbounded window overlaps everything on that
  // side. Two fully open windows always overlap, which is exactly why a second "always" price for
  // the same break has to be refused.
  const aStart = a.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const aEnd = a.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = b.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bEnd = b.validTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * The applicable item, or null when the list has nothing for this quantity at this instant.
 *
 * Returning null rather than a fallback is what makes the resolution chain work: a list that
 * carries the variant but has no break low enough, or whose only price expired yesterday, must
 * fall through to the next list rather than be treated as an answer.
 *
 * Ties on `minQuantity` cannot happen within a single (list, variant, unit) — the unique key
 * forbids it — but the comparison breaks them on id anyway, so the result stays deterministic if
 * a caller ever passes items from more than one list.
 */
export function selectApplicableItem(
  items: PricedItem[],
  quantity: number,
  at: Date,
): PricedItem | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;

  const candidates = items
    .filter((item) => item.minQuantity <= quantity)
    .filter((item) => isWithinWindow(item, at));

  if (candidates.length === 0) return null;

  return candidates.reduce((best, item) => {
    if (item.minQuantity > best.minQuantity) return item;
    if (item.minQuantity === best.minQuantity && item.id < best.id) return item;
    return best;
  });
}

export type PriceQuantityError = "not_an_integer" | "not_positive";

/** The same integer contract as everywhere else: quantities are whole and positive. */
export function validatePriceQuantity(quantity: unknown): PriceQuantityError | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return "not_an_integer";
  }
  if (quantity <= 0) return "not_positive";
  return null;
}

export type MoneyError = "not_an_integer" | "negative" | "too_large";

/** A hundred million minor units — ten lakh rupees for one unit. Beyond this is a typo. */
export const MAX_UNIT_PRICE_MINOR = 100_000_000;

/**
 * Money is integer minor units, as in every other money column in this system.
 *
 * Zero is valid and means a deliberately free line. It is not a promotion, a coupon or a
 * free-quantity rule — those do not exist here — it is simply the price somebody entered, and
 * refusing it would force them to express "no charge" as a lie somewhere else.
 */
export function validateUnitPrice(unitPriceMinor: unknown): MoneyError | null {
  if (
    typeof unitPriceMinor !== "number" ||
    !Number.isFinite(unitPriceMinor) ||
    !Number.isInteger(unitPriceMinor)
  ) {
    return "not_an_integer";
  }
  if (unitPriceMinor < 0) return "negative";
  if (unitPriceMinor > MAX_UNIT_PRICE_MINOR) return "too_large";
  return null;
}
