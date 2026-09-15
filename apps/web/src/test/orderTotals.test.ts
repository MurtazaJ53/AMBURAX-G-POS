import { describe, it, expect } from "vitest";
import {
  MAX_ORDER_LINE_QUANTITY,
  MAX_ORDER_UNIT_PRICE_MINOR,
  computeLineTotalMinor,
  computeSubtotalMinor,
  validateFulfilQuantity,
  validateOrderQuantity,
  validateOrderUnitPrice,
} from "@/server/orders/orderTotals";

describe("order quantities are integers", () => {
  it("accepts a whole positive quantity", () => {
    expect(validateOrderQuantity(1)).toBeNull();
    expect(validateOrderQuantity(250)).toBeNull();
  });

  /** The P1-8C contract, restated where orders enforce it. No decimals anywhere. */
  it("refuses fractions", () => {
    expect(validateOrderQuantity(1.5)).toBe("not_an_integer");
    expect(validateOrderQuantity(0.1)).toBe("not_an_integer");
    expect(validateOrderQuantity(2.0000001)).toBe("not_an_integer");
  });

  it("refuses zero and negatives", () => {
    expect(validateOrderQuantity(0)).toBe("not_positive");
    expect(validateOrderQuantity(-1)).toBe("not_positive");
  });

  it("refuses anything that is not a finite number", () => {
    expect(validateOrderQuantity("5")).toBe("not_an_integer");
    expect(validateOrderQuantity(null)).toBe("not_an_integer");
    expect(validateOrderQuantity(undefined)).toBe("not_an_integer");
    expect(validateOrderQuantity(NaN)).toBe("not_an_integer");
    expect(validateOrderQuantity(Infinity)).toBe("not_an_integer");
  });

  it("refuses an implausible quantity", () => {
    expect(validateOrderQuantity(MAX_ORDER_LINE_QUANTITY)).toBeNull();
    expect(validateOrderQuantity(MAX_ORDER_LINE_QUANTITY + 1)).toBe("too_large");
  });
});

describe("order money is integer minor units", () => {
  it("accepts whole amounts", () => {
    expect(validateOrderUnitPrice(95000)).toBeNull();
  });

  /** Zero is a real price, because P1-8E allows one and a line must carry what it resolved. */
  it("accepts zero", () => {
    expect(validateOrderUnitPrice(0)).toBeNull();
  });

  /** A negative line is a refund, and refunds are not orders. */
  it("refuses negatives", () => {
    expect(validateOrderUnitPrice(-1)).toBe("negative");
  });

  it("refuses fractions — there is no such thing as half a paisa", () => {
    expect(validateOrderUnitPrice(10.5)).toBe("not_an_integer");
  });

  it("refuses an implausible amount", () => {
    expect(validateOrderUnitPrice(MAX_ORDER_UNIT_PRICE_MINOR)).toBeNull();
    expect(validateOrderUnitPrice(MAX_ORDER_UNIT_PRICE_MINOR + 1)).toBe("too_large");
  });
});

describe("line and order arithmetic", () => {
  it("multiplies exactly, with no rounding step to get wrong", () => {
    expect(computeLineTotalMinor(3, 95000)).toBe(285000);
    expect(computeLineTotalMinor(1, 0)).toBe(0);
  });

  it("sums the lines and nothing else", () => {
    expect(computeSubtotalMinor([{ lineTotalMinor: 285000 }, { lineTotalMinor: 15000 }])).toBe(
      300000,
    );
  });

  it("is zero for an order with no lines", () => {
    expect(computeSubtotalMinor([])).toBe(0);
  });

  /**
   * Tax and discount are deliberately excluded from an order in this phase, so the subtotal is
   * the whole of its value. This test exists to make that an asserted decision rather than an
   * assumption someone later reads as an oversight.
   */
  it("adds no tax and no discount", () => {
    expect(computeSubtotalMinor([{ lineTotalMinor: 100000 }])).toBe(100000);
  });
});

describe("recording fulfilment", () => {
  it("accepts a quantity within what remains", () => {
    expect(validateFulfilQuantity(3, 0, 5)).toBeNull();
    expect(validateFulfilQuantity(2, 3, 5)).toBeNull();
  });

  /**
   * Over-delivery is refused rather than clamped. Absorbing it silently would erase a
   * disagreement between what was ordered and what arrived — exactly the thing someone needs to
   * see.
   */
  it("refuses more than was ordered", () => {
    expect(validateFulfilQuantity(6, 0, 5)).toBe("exceeds_ordered");
    expect(validateFulfilQuantity(3, 3, 5)).toBe("exceeds_ordered");
  });

  it("refuses zero, negatives and fractions", () => {
    expect(validateFulfilQuantity(0, 0, 5)).toBe("not_positive");
    expect(validateFulfilQuantity(-1, 0, 5)).toBe("not_positive");
    expect(validateFulfilQuantity(1.5, 0, 5)).toBe("not_an_integer");
  });
});
