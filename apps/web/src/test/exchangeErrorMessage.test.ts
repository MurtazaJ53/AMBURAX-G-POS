import { describe, expect, it } from "vitest";
import { exchangeErrorMessage } from "@/app/(app)/sales/[id]/exchange/ExchangeClient";

// API errors arrive as { error: { code, message } }. The exchange screen read data.message, so every
// refusal ("Only 1 returnable", "Original bill not found") showed as the generic fallback.

describe("exchange error message", () => {
  it("shows the server's message", () => {
    expect(exchangeErrorMessage({ error: { code: "EXCEEDED_QUANTITY", message: "Cannot return 2 of Shirt. Only 1 returnable." } })).toBe(
      "Cannot return 2 of Shirt. Only 1 returnable.",
    );
  });

  it("falls back to a generic message when there is none", () => {
    expect(exchangeErrorMessage(null)).toBe("Exchange transaction failed.");
    expect(exchangeErrorMessage({})).toBe("Exchange transaction failed.");
  });
});
