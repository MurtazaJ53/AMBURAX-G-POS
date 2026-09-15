import { describe, it, expect } from "vitest";
import {
  billItemCount,
  billLinesForSubmission,
  billReducer,
  billTotals,
  emptyBill,
  MAX_LINES_PER_SALE,
  MAX_LINE_QUANTITY,
} from "@/client/pos/bill";
import type { ScannedItem } from "@/client/pos/types";

function item(overrides: Partial<ScannedItem> = {}): ScannedItem {
  return {
    variantId: "var-1",
    productName: "Cotton Shirt",
    sku: "SHIRT-M-BLUE",
    barcode: "890",
    size: "M",
    colour: "Blue",
    priceMinor: 10000,
    taxRateBp: 500,
    stockQuantity: 4,
    isActive: true,
    ...overrides,
  };
}

const base = emptyBill("bill-key-1");

describe("the bill", () => {
  it("adds a scanned item as one line", () => {
    const next = billReducer(base, { type: "scanned", item: item() });
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0]?.quantity).toBe(1);
  });

  it("increments rather than duplicating when the same item is scanned again", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "scanned", item: item() });
    state = billReducer(state, { type: "scanned", item: item() });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]?.quantity).toBe(3);
    expect(billItemCount(state)).toBe(3);
  });

  it("refuses to put a withdrawn item on the bill", () => {
    const next = billReducer(base, { type: "scanned", item: item({ isActive: false }) });
    expect(next.lines).toHaveLength(0);
  });

  it("removes a line when the quantity is stepped below one", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "quantity_step", variantId: "var-1", by: -1 });
    expect(state.lines).toHaveLength(0);
  });

  it("clamps a quantity above the maximum a sale accepts", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, {
      type: "quantity_set",
      variantId: "var-1",
      quantity: MAX_LINE_QUANTITY + 5000,
    });
    expect(state.lines[0]?.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("rejects a fractional quantity rather than sending one", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "quantity_set", variantId: "var-1", quantity: 2.6 });
    expect(Number.isInteger(state.lines[0]?.quantity)).toBe(true);
  });

  it("stops accepting new lines at the limit a sale allows", () => {
    let state = base;
    for (let i = 0; i < MAX_LINES_PER_SALE + 3; i += 1) {
      state = billReducer(state, { type: "scanned", item: item({ variantId: `var-${i}` }) });
    }
    expect(state.lines).toHaveLength(MAX_LINES_PER_SALE);
  });

  it("attaches and removes a customer without touching the lines", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, {
      type: "customer_attached",
      customer: { id: "cust-1", name: "Asha", phone: "+91 90000 00000" },
    });
    expect(state.customer?.id).toBe("cust-1");
    state = billReducer(state, { type: "customer_cleared" });
    expect(state.customer).toBeNull();
    expect(state.lines).toHaveLength(1);
  });

  it("keeps one idempotency key for the life of a bill and takes a new one when cleared", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "quantity_step", variantId: "var-1", by: 1 });
    // Every edit keeps the key, so a retry after any of them replays the same sale rather
    // than creating a second one.
    expect(state.idempotencyKey).toBe("bill-key-1");
    state = billReducer(state, { type: "cleared", idempotencyKey: "bill-key-2" });
    expect(state.idempotencyKey).toBe("bill-key-2");
    expect(state.lines).toHaveLength(0);
  });

  it("sends what and how many, and no money at all", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "quantity_set", variantId: "var-1", quantity: 2 });
    const lines = billLinesForSubmission(state);
    expect(lines).toEqual([{ variantId: "var-1", quantity: 2 }]);
    // The guarantee, stated as a test: no price, no tax, no total leaves the browser.
    const keys = Object.keys(lines[0] ?? {});
    expect(keys).not.toContain("unitPriceMinor");
    expect(keys).not.toContain("taxRateBp");
  });

  it("previews totals with the same function the server charges with", () => {
    let state = billReducer(base, { type: "scanned", item: item() });
    state = billReducer(state, { type: "quantity_set", variantId: "var-1", quantity: 3 });
    const totals = billTotals(state);
    expect(totals.totalMinor).toBe(30000);
    expect(totals.subtotalMinor + totals.taxMinor).toBe(totals.totalMinor);
  });
});
