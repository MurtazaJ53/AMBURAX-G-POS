import { describe, it, expect } from "vitest";
import { classifyScan, stockLabel } from "@/client/pos/scanResult";
import type { ApiResult } from "@/client/platform/apiClient";
import type { ScannedItem } from "@/client/pos/types";

/**
 * Scanning has three failure modes a counter routinely confuses, and the whole point of this
 * classifier is that they stay three. These tests exist to make merging any two of them fail.
 */

function item(overrides: Partial<ScannedItem> = {}): ScannedItem {
  return {
    variantId: "var-1",
    productName: "Cotton Shirt",
    sku: "SHIRT-M-BLUE",
    barcode: "8901234567890",
    size: "M",
    colour: "Blue",
    priceMinor: 129900,
    taxRateBp: 500,
    stockQuantity: 4,
    isActive: true,
    ...overrides,
  };
}

const ok = (value: ScannedItem): ApiResult<{ item: ScannedItem }> => ({
  ok: true,
  status: 200,
  data: { item: value },
  correlationId: "cid-1",
});

describe("classifyScan", () => {
  it("returns the item when it is active", () => {
    const outcome = classifyScan("8901234567890", ok(item()));
    expect(outcome.kind).toBe("found");
  });

  it("distinguishes a withdrawn item from an unknown barcode, and names it", () => {
    const outcome = classifyScan("8901234567890", ok(item({ isActive: false })));
    expect(outcome.kind).toBe("not_for_sale");
    // The item must come back with the outcome: a cashier has to be able to tell the customer
    // which item is withdrawn, which is why the API returns it rather than 404-ing.
    if (outcome.kind === "not_for_sale") {
      expect(outcome.item.productName).toBe("Cotton Shirt");
    }
  });

  it("treats only a 404 as barcode-not-found", () => {
    const outcome = classifyScan("nope", {
      ok: false,
      kind: "api",
      status: 404,
      code: "not_found",
      message: "No item matches that barcode.",
      correlationId: "cid-2",
    });
    expect(outcome.kind).toBe("not_found");
  });

  it("does not report a failed lookup as barcode-not-found", () => {
    // A 503 says the lookup failed, not that the item is absent. Saying not-found here is a
    // lie the cashier acts on: they would send the customer away.
    const outcome = classifyScan("8901234567890", {
      ok: false,
      kind: "api",
      status: 503,
      code: "service_unavailable",
      message: "Lookup is temporarily unavailable.",
      correlationId: "cid-3",
    });
    expect(outcome.kind).toBe("error");
  });

  it("reports a timeout as an error rather than a verdict about the item", () => {
    const outcome = classifyScan("8901234567890", { ok: false, kind: "timeout" });
    expect(outcome.kind).toBe("error");
  });
});

describe("stockLabel", () => {
  it("never renders a never-counted variant as zero", () => {
    expect(stockLabel(null)).toBe("Not counted");
    expect(stockLabel(null)).not.toContain("0");
  });

  it("distinguishes zero from never counted", () => {
    expect(stockLabel(0)).toBe("No stock recorded");
    expect(stockLabel(0)).not.toBe(stockLabel(null));
  });

  it("reports a positive count", () => {
    expect(stockLabel(4)).toBe("4 in stock");
  });
});
