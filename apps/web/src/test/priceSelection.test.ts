import { describe, expect, it } from "vitest";
import {
  selectApplicableItem,
  isWithinWindow,
  isWindowCoherent,
  windowsOverlap,
  validateUnitPrice,
  validatePriceQuantity,
  MAX_UNIT_PRICE_MINOR,
  type PricedItem,
} from "@/server/pricing/priceSelection";

/**
 * Price selection, which is pure and therefore testable without a database.
 *
 * The resolution chain, tenant isolation and the database constraints are proven against real
 * PostgreSQL in `src/test-integration/pricing.test.ts`.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");

function item(over: Partial<PricedItem> = {}): PricedItem {
  return {
    id: "pli-1",
    minQuantity: 1,
    unitPriceMinor: 100_000,
    validFrom: null,
    validTo: null,
    ...over,
  };
}

/** The worked example from the phase brief: breaks at 1, 10 and 50. */
const BREAKS: PricedItem[] = [
  item({ id: "b1", minQuantity: 1, unitPriceMinor: 100_000 }),
  item({ id: "b10", minQuantity: 10, unitPriceMinor: 95_000 }),
  item({ id: "b50", minQuantity: 50, unitPriceMinor: 90_000 }),
];

describe("quantity breaks", () => {
  it("takes the highest break that does not exceed the quantity", () => {
    const cases: [number, string][] = [
      [1, "b1"],
      [9, "b1"],
      [10, "b10"],
      [49, "b10"],
      [50, "b50"],
      [500, "b50"],
    ];

    for (const [quantity, expected] of cases) {
      expect(selectApplicableItem(BREAKS, quantity, NOW)?.id).toBe(expected);
    }
  });

  it("returns null when every break is above the quantity", () => {
    // The list carries the variant but has nothing this small. That is a fall-through, not an
    // answer — the resolution chain depends on this returning null rather than the cheapest row.
    const highOnly = [item({ id: "b10", minQuantity: 10 })];
    expect(selectApplicableItem(highOnly, 5, NOW)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(selectApplicableItem([], 5, NOW)).toBeNull();
  });

  it("rejects a fractional or non-positive quantity rather than guessing", () => {
    expect(selectApplicableItem(BREAKS, 1.5, NOW)).toBeNull();
    expect(selectApplicableItem(BREAKS, 0, NOW)).toBeNull();
    expect(selectApplicableItem(BREAKS, -5, NOW)).toBeNull();
  });
});

describe("validity windows", () => {
  const past = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-12-31T00:00:00.000Z");

  it("both null means always", () => {
    expect(isWithinWindow({ validFrom: null, validTo: null }, NOW)).toBe(true);
  });

  it("before validFrom is not eligible", () => {
    expect(isWithinWindow({ validFrom: future, validTo: null }, NOW)).toBe(false);
  });

  it("after validTo is not eligible", () => {
    expect(isWithinWindow({ validFrom: null, validTo: past }, NOW)).toBe(false);
  });

  it("inside the window is eligible", () => {
    expect(isWithinWindow({ validFrom: past, validTo: future }, NOW)).toBe(true);
  });

  it("is inclusive at both ends", () => {
    // A price valid "from today" applies today; one valid "to the 31st" applies on the 31st.
    expect(isWithinWindow({ validFrom: NOW, validTo: null }, NOW)).toBe(true);
    expect(isWithinWindow({ validFrom: null, validTo: NOW }, NOW)).toBe(true);
  });

  it("skips an expired break and falls back to a lower one that still applies", () => {
    const items = [
      item({ id: "b1", minQuantity: 1, unitPriceMinor: 100_000 }),
      item({ id: "b10", minQuantity: 10, unitPriceMinor: 95_000, validTo: past }),
    ];
    // The 10 break expired, so 20 units price at the base break rather than at nothing.
    expect(selectApplicableItem(items, 20, NOW)?.id).toBe("b1");
  });

  it("ignores a break that has not started yet", () => {
    const items = [
      item({ id: "b1", minQuantity: 1 }),
      item({ id: "b10", minQuantity: 10, validFrom: future }),
    ];
    expect(selectApplicableItem(items, 20, NOW)?.id).toBe("b1");
  });

  it("accepts a coherent window and rejects one that ends before it starts", () => {
    expect(isWindowCoherent(past, future)).toBe(true);
    expect(isWindowCoherent(future, past)).toBe(false);
    expect(isWindowCoherent(null, null)).toBe(true);
    expect(isWindowCoherent(past, null)).toBe(true);
  });
});

describe("window overlap", () => {
  const jan = new Date("2026-01-01T00:00:00.000Z");
  const jun = new Date("2026-06-01T00:00:00.000Z");
  const jul = new Date("2026-07-01T00:00:00.000Z");
  const dec = new Date("2026-12-01T00:00:00.000Z");

  it("two open windows always overlap", () => {
    // Which is why a second "always" price for the same break is a replacement, not an addition.
    expect(
      windowsOverlap({ validFrom: null, validTo: null }, { validFrom: null, validTo: null }),
    ).toBe(true);
  });

  it("an open window overlaps any bounded one", () => {
    expect(windowsOverlap({ validFrom: null, validTo: null }, { validFrom: jan, validTo: jun })).toBe(
      true,
    );
  });

  it("adjacent but disjoint windows do not overlap", () => {
    expect(windowsOverlap({ validFrom: jan, validTo: jun }, { validFrom: jul, validTo: dec })).toBe(
      false,
    );
  });

  it("windows that share an instant overlap", () => {
    expect(windowsOverlap({ validFrom: jan, validTo: jul }, { validFrom: jun, validTo: dec })).toBe(
      true,
    );
  });
});

describe("money", () => {
  it("allows zero — an explicitly free line, not a promotion", () => {
    expect(validateUnitPrice(0)).toBeNull();
  });

  it("rejects a negative price", () => {
    expect(validateUnitPrice(-1)).toBe("negative");
  });

  it("rejects fractional minor units", () => {
    // Money is integer minor units everywhere in this system; half a paisa does not exist.
    expect(validateUnitPrice(100.5)).toBe("not_an_integer");
  });

  it("rejects values that are not finite numbers", () => {
    expect(validateUnitPrice(NaN)).toBe("not_an_integer");
    expect(validateUnitPrice("100")).toBe("not_an_integer");
    expect(validateUnitPrice(null)).toBe("not_an_integer");
  });

  it("accepts the ceiling and rejects beyond it", () => {
    expect(validateUnitPrice(MAX_UNIT_PRICE_MINOR)).toBeNull();
    expect(validateUnitPrice(MAX_UNIT_PRICE_MINOR + 1)).toBe("too_large");
  });
});

describe("quantity contract", () => {
  it("accepts whole positive quantities", () => {
    expect(validatePriceQuantity(1)).toBeNull();
    expect(validatePriceQuantity(500)).toBeNull();
  });

  it("rejects zero, negatives and fractions", () => {
    expect(validatePriceQuantity(0)).toBe("not_positive");
    expect(validatePriceQuantity(-1)).toBe("not_positive");
    expect(validatePriceQuantity(2.5)).toBe("not_an_integer");
  });
});
