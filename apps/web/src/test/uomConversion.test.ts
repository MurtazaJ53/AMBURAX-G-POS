import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  validateFactor,
  MAX_CONVERTED_QUANTITY,
  type ConversionEdge,
  type UomLike,
} from "@/server/uom/conversion";

/**
 * The conversion arithmetic, which is pure and therefore testable without a database.
 *
 * Tenant isolation, uniqueness under concurrency and the service layer are proven against real
 * PostgreSQL in `src/test-integration/uom.test.ts`.
 */

const PCS: UomLike = { id: "u-pcs", code: "PCS", decimalPlaces: 0 };
const PACK: UomLike = { id: "u-pack", code: "PACK", decimalPlaces: 0 };
const DOZEN: UomLike = { id: "u-dozen", code: "DOZEN", decimalPlaces: 0 };
const CARTON: UomLike = { id: "u-carton", code: "CARTON", decimalPlaces: 0 };
const METRE: UomLike = { id: "u-metre", code: "METRE", decimalPlaces: 3 };

/** The garment set: every packaging unit defined against the base counting unit. */
const EDGES: ConversionEdge[] = [
  { fromUomId: PACK.id, toUomId: PCS.id, factor: 6 },
  { fromUomId: DOZEN.id, toUomId: PCS.id, factor: 12 },
  { fromUomId: CARTON.id, toUomId: PCS.id, factor: 24 },
];

function convert(quantity: number, from: UomLike, to: UomLike, edges = EDGES) {
  return convertQuantity({ quantity, from, to, edges });
}

describe("the garment conversions", () => {
  it("1 DOZEN is 12 PCS", () => {
    expect(convert(1, DOZEN, PCS)).toEqual({ status: "ok", quantity: 12 });
  });

  it("1 CARTON is 24 PCS", () => {
    expect(convert(1, CARTON, PCS)).toEqual({ status: "ok", quantity: 24 });
  });

  it("1 PACK is 6 PCS", () => {
    expect(convert(1, PACK, PCS)).toEqual({ status: "ok", quantity: 6 });
  });

  it("multiplies exactly: 2 DOZEN is 24 PCS", () => {
    expect(convert(2, DOZEN, PCS)).toEqual({ status: "ok", quantity: 24 });
  });

  it("converts a unit to itself unchanged", () => {
    expect(convert(5, PCS, PCS)).toEqual({ status: "ok", quantity: 5 });
  });
});

describe("reverse conversion", () => {
  it("24 PCS is 2 DOZEN", () => {
    expect(convert(24, PCS, DOZEN)).toEqual({ status: "ok", quantity: 2 });
  });

  it("13 PCS is REFUSED, not rounded down to 1 DOZEN", () => {
    // The rule the whole phase turns on. Flooring would destroy a piece; rounding up would
    // invent one. Neither is allowed to happen silently to a stock balance.
    expect(convert(13, PCS, DOZEN)).toEqual({
      status: "not_exact",
      remainder: 1,
      inUnitCode: "PCS",
    });
  });

  it("names the remainder in the unit the caller is holding", () => {
    const result = convert(25, PCS, CARTON);
    expect(result).toEqual({ status: "not_exact", remainder: 1, inUnitCode: "PCS" });
  });
});

describe("conversion across a shared unit", () => {
  it("4 CARTON is 8 DOZEN, via pieces", () => {
    // 4 x 24 = 96 pieces; 96 / 12 = 8 dozen. Exact at both steps.
    expect(convert(4, CARTON, DOZEN)).toEqual({ status: "ok", quantity: 8 });
  });

  it("2 DOZEN is 4 PACK", () => {
    expect(convert(2, DOZEN, PACK)).toEqual({ status: "ok", quantity: 4 });
  });

  it("refuses when the shared-unit result does not divide evenly", () => {
    // 1 dozen is 12 pieces; a carton is 24, so half a carton — which does not exist here.
    expect(convert(1, DOZEN, CARTON)).toEqual({
      status: "not_exact",
      remainder: 12,
      inUnitCode: "CARTON",
    });
  });

  it("reports no path when the units share nothing", () => {
    const orphan: UomLike = { id: "u-orphan", code: "BOX", decimalPlaces: 0 };
    expect(convert(1, orphan, PCS)).toEqual({ status: "no_conversion_path" });
  });

  it("reports no path when there are no conversions at all", () => {
    expect(convert(1, DOZEN, PCS, [])).toEqual({ status: "no_conversion_path" });
  });
});

describe("quantity validation", () => {
  it("rejects zero", () => {
    expect(convert(0, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "not_positive",
    });
  });

  it("rejects a negative quantity", () => {
    expect(convert(-3, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "not_positive",
    });
  });

  it("rejects a fraction rather than rounding it", () => {
    expect(convert(1.5, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "not_an_integer",
    });
  });

  it("rejects values that are not finite numbers", () => {
    expect(convert(NaN, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "not_an_integer",
    });
    expect(convert(Infinity, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "not_an_integer",
    });
  });

  it("rejects a quantity beyond the ceiling", () => {
    expect(convert(MAX_CONVERTED_QUANTITY + 1, DOZEN, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "too_large",
    });
  });

  it("rejects a result that would exceed the ceiling even when the input does not", () => {
    // 100,000 cartons is a plausible-looking input and 2.4 million pieces is not a storable
    // quantity. The guard has to sit on the product, not only on the operand.
    expect(convert(100_000, CARTON, PCS)).toEqual({
      status: "invalid_quantity",
      reason: "too_large",
    });
  });
});

describe("decimal units are catalogued but not computable", () => {
  it("refuses to convert out of a decimal unit", () => {
    expect(convert(2, METRE, PCS)).toEqual({
      status: "decimal_uom_unsupported",
      uomCode: "METRE",
    });
  });

  it("refuses to convert into a decimal unit", () => {
    expect(convert(2, PCS, METRE)).toEqual({
      status: "decimal_uom_unsupported",
      uomCode: "METRE",
    });
  });

  it("refuses even the identity case, so the limitation surfaces early", () => {
    expect(convert(2, METRE, METRE)).toEqual({
      status: "decimal_uom_unsupported",
      uomCode: "METRE",
    });
  });
});

describe("conversion factors", () => {
  it("accepts a whole number of at least two", () => {
    expect(validateFactor(2)).toBeNull();
    expect(validateFactor(12)).toBeNull();
  });

  it("rejects one — that is a synonym, not a conversion", () => {
    expect(validateFactor(1)).toBe("too_small");
  });

  it("rejects zero and negatives", () => {
    expect(validateFactor(0)).toBe("too_small");
    expect(validateFactor(-12)).toBe("too_small");
  });

  it("rejects a fractional factor, which would produce unstorable quantities", () => {
    expect(validateFactor(1.5)).toBe("not_an_integer");
    expect(validateFactor(0.5)).toBe("not_an_integer");
  });

  it("rejects a non-number", () => {
    expect(validateFactor("12")).toBe("not_an_integer");
    expect(validateFactor(null)).toBe("not_an_integer");
    expect(validateFactor(NaN)).toBe("not_an_integer");
  });

  it("rejects an implausibly large factor", () => {
    expect(validateFactor(100_001)).toBe("too_large");
  });
});
