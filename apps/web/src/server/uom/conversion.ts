/**
 * Exact integer conversion between units.
 *
 * Pure arithmetic, no database: the rules are worth reading on their own, and the awkward case
 * (13 pieces into dozens) deserves to be decided here rather than discovered inside a
 * transaction.
 *
 * ## The contract
 *
 * A conversion row says **"one `fromUom` contains `factor` of `toUom`"**, stored in one
 * direction only, always larger-to-smaller, always with an integer factor of at least two:
 *
 *     1 DOZEN  = 12 PCS
 *     1 CARTON = 24 PCS
 *     1 PACK   =  6 PCS
 *
 * Four conversions are possible, and nothing else:
 *
 * | Direction | Arithmetic | Example |
 * |---|---|---|
 * | Identity | unchanged | 5 PCS -> 5 PCS |
 * | Down a defined edge | `quantity x factor` | 2 DOZEN -> 24 PCS |
 * | Up a defined edge | `quantity / factor`, **exact only** | 24 PCS -> 2 DOZEN |
 * | Across a shared smaller unit | down, then up | 4 CARTON -> 8 DOZEN (96 PCS) |
 *
 * ## The rule for inexact conversions: reject
 *
 * `13 PCS -> DOZEN` does not become 1. It is refused, with `not_exact`, naming the remainder.
 *
 * This is the point of the phase. Every quantity in this system is an integer — a sale line, a
 * stock balance, a movement delta — so "one and a bit dozen" has nowhere to live. Rounding up
 * would create stock that does not exist; flooring would destroy stock that does. The only
 * honest answers are to keep the quantity in the smaller unit or to refuse, and refusing is the
 * one that cannot silently corrupt a balance, so the caller is told and decides.
 *
 * A caller who wants leniency should not convert at all: they should keep the number in base
 * units, which is what every stored quantity already is.
 */

export interface UomLike {
  id: string;
  code: string;
  decimalPlaces: number;
}

export interface ConversionEdge {
  fromUomId: string;
  toUomId: string;
  /** One `fromUom` contains this many `toUom`. Always an integer >= 2. */
  factor: number;
}

export type ConversionFailure =
  | { status: "invalid_quantity"; reason: "not_an_integer" | "not_positive" | "too_large" }
  /** The quantity does not divide evenly into the target unit. */
  | { status: "not_exact"; remainder: number; inUnitCode: string }
  /** No identity, direct, reverse or shared-unit path exists between the two units. */
  | { status: "no_conversion_path" }
  /**
   * One of the units declares decimal places. The catalogue may describe METRE or KG so a
   * business can write down what it sells, but no quantity column in this system can hold a
   * fraction, so computing with such a unit is refused rather than truncated.
   */
  | { status: "decimal_uom_unsupported"; uomCode: string };

export type ConversionResult = { status: "ok"; quantity: number } | ConversionFailure;

/**
 * Same ceiling as a stock movement. Conversion multiplies, so the guard has to sit on the result
 * as well as the input: 500,000 cartons of 24 is not a quantity, it is an overflow waiting to be
 * stored.
 */
export const MAX_CONVERTED_QUANTITY = 1_000_000;

export const MAX_CONVERSION_FACTOR = 100_000;

export type FactorError = "not_an_integer" | "too_small" | "too_large";

/**
 * A factor must be a whole number of at least two.
 *
 * Two, not one: a factor of one makes two units interchangeable, which is a synonym rather than
 * a conversion, and would let `A -> B` and `B -> A` both be true and both be stored — the
 * contradiction the single-direction rule exists to prevent.
 */
export function validateFactor(factor: unknown): FactorError | null {
  if (typeof factor !== "number" || !Number.isFinite(factor) || !Number.isInteger(factor)) {
    return "not_an_integer";
  }
  if (factor < 2) return "too_small";
  if (factor > MAX_CONVERSION_FACTOR) return "too_large";
  return null;
}

function validateQuantity(quantity: unknown): ConversionFailure | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return { status: "invalid_quantity", reason: "not_an_integer" };
  }
  if (quantity <= 0) return { status: "invalid_quantity", reason: "not_positive" };
  if (quantity > MAX_CONVERTED_QUANTITY) {
    return { status: "invalid_quantity", reason: "too_large" };
  }
  return null;
}

/**
 * Convert `quantity` of `from` into `to`, using only the supplied edges.
 *
 * `edges` is the tenant's complete conversion set, already fetched and already tenant-scoped by
 * the caller. This function never queries and never guesses: a unit pair it cannot reach through
 * one of the four documented paths is `no_conversion_path`, not an approximation.
 */
export function convertQuantity(params: {
  quantity: number;
  from: UomLike;
  to: UomLike;
  edges: ConversionEdge[];
}): ConversionResult {
  const { quantity, from, to, edges } = params;

  const badQuantity = validateQuantity(quantity);
  if (badQuantity) return badQuantity;

  // Checked before any arithmetic, including for the identity case: a caller asking to convert
  // METRE to METRE should learn that this system cannot yet count in metres, rather than get an
  // answer that will not survive being stored.
  if (from.decimalPlaces > 0) {
    return { status: "decimal_uom_unsupported", uomCode: from.code };
  }
  if (to.decimalPlaces > 0) {
    return { status: "decimal_uom_unsupported", uomCode: to.code };
  }

  if (from.id === to.id) return { status: "ok", quantity };

  // Down: one `from` contains factor `to`.
  const down = edges.find((e) => e.fromUomId === from.id && e.toUomId === to.id);
  if (down) return multiply(quantity, down.factor);

  // Up: one `to` contains factor `from`, so divide — and only if it divides evenly.
  const up = edges.find((e) => e.fromUomId === to.id && e.toUomId === from.id);
  if (up) return divide(quantity, up.factor, from.code);

  // Across: both units are defined against the same smaller unit, which in practice is the
  // product's base unit. DOZEN and CARTON both convert to PCS, so DOZEN -> CARTON goes down to
  // pieces and back up, and is exact only if the piece count divides evenly.
  const fromDown = edges.filter((e) => e.fromUomId === from.id);
  const toDown = edges.filter((e) => e.fromUomId === to.id);
  for (const a of fromDown) {
    const b = toDown.find((candidate) => candidate.toUomId === a.toUomId);
    if (!b) continue;

    const inShared = multiply(quantity, a.factor);
    if (inShared.status !== "ok") return inShared;
    return divide(inShared.quantity, b.factor, to.code);
  }

  return { status: "no_conversion_path" };
}

function multiply(quantity: number, factor: number): ConversionResult {
  const product = quantity * factor;
  if (product > MAX_CONVERTED_QUANTITY) {
    return { status: "invalid_quantity", reason: "too_large" };
  }
  return { status: "ok", quantity: product };
}

/**
 * Divide, or refuse. The remainder is reported in the unit the quantity is currently in, which is
 * the number an operator can act on: "13 pieces is one dozen with 1 left over".
 */
function divide(quantity: number, factor: number, remainderUnitCode: string): ConversionResult {
  const remainder = quantity % factor;
  if (remainder !== 0) {
    return { status: "not_exact", remainder, inUnitCode: remainderUnitCode };
  }
  return { status: "ok", quantity: quantity / factor };
}
