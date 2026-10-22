import { describe, expect, it } from "vitest";
import { gstinStateCode, gstStateCode } from "@/lib/gstStates";

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
});
