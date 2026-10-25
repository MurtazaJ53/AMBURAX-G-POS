import { describe, expect, it } from "vitest";
import { gstinStateCode, gstStateCode, storeStateOutsideGstin } from "@/lib/gstStates";

describe("GST state codes", () => {
  it("maps full names, abbreviations and common spellings", () => {
    expect(gstStateCode("Karnataka")).toBe("29");
    expect(gstStateCode("  maharashtra ")).toBe("27");
    expect(gstStateCode("MH")).toBe("27");
    expect(gstStateCode("New Delhi")).toBe("07");
    expect(gstStateCode("Jammu & Kashmir")).toBe("01");
    expect(gstStateCode("Orissa")).toBe("21");
    expect(gstStateCode("TS")).toBe("36");
  });

  it("returns null rather than guessing", () => {
    expect(gstStateCode("Atlantis")).toBeNull();
    expect(gstStateCode("")).toBeNull();
    expect(gstStateCode(null)).toBeNull();
  });

  it("reads the state from a GSTIN", () => {
    expect(gstinStateCode("29ABCDE1234F1Z5")).toBe("29");
    expect(gstinStateCode("XXABCDE1234F1Z5")).toBeNull();
    expect(gstinStateCode(null)).toBeNull();
  });

  it("keeps a GST-registered business's stores in its GSTIN's state, and leaves others free", () => {
    const gujarat = "24ABCDE1234F1Z6";
    expect(storeStateOutsideGstin(gujarat, "Gujarat")).toBeNull();
    expect(storeStateOutsideGstin(gujarat, " GJ ")).toBeNull();
    expect(storeStateOutsideGstin(gujarat, "Maharashtra")).toBe(
      "Your GSTIN is registered in Gujarat, so every store in this business must be in Gujarat. A store in another state needs its own GST registration and a separate business.",
    );
    expect(storeStateOutsideGstin(gujarat, "Atlantis")).toMatch(/registered in Gujarat/);
    // No GSTIN, or not a GSTIN: no restriction.
    expect(storeStateOutsideGstin(null, "Maharashtra")).toBeNull();
    expect(storeStateOutsideGstin("", "Maharashtra")).toBeNull();
    expect(storeStateOutsideGstin("XXABCDE1234F1Z5", "Maharashtra")).toBeNull();
  });
});
