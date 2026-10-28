import { describe, expect, it } from "vitest";
import { INDIAN_STATES, gstinStateCode, gstStateCode, storeStateOutsideGstin, storesOutsideGstin } from "@/lib/gstStates";

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

  it("names every existing store outside a new GSTIN's state", () => {
    const gujarat = "24ABCDE1234F1Z6";
    expect(storesOutsideGstin(gujarat, [{ name: "Main", state: "Gujarat" }])).toBeNull();
    expect(
      storesOutsideGstin(gujarat, [
        { name: "Main", state: "Gujarat" },
        { name: "Pune", state: "Maharashtra" },
        { name: "Delhi", state: "Delhi" },
      ]),
    ).toMatch(/^Your GSTIN is registered in Gujarat, but Pune \(Maharashtra\), Delhi \(Delhi\) are in another state\./);
  });
});

describe("state names for the add-store picker (bug 34)", () => {
  it("are title case, with 'and' left lowercase", () => {
    expect(INDIAN_STATES).toContain("Gujarat");
    expect(INDIAN_STATES).toContain("Madhya Pradesh");
    expect(INDIAN_STATES).toContain("Jammu and Kashmir");
    expect(INDIAN_STATES).toContain("Dadra and Nagar Haveli and Daman and Diu");
    for (const name of INDIAN_STATES) expect(name).toMatch(/^[A-Z][a-z]*( (and|[A-Z][a-z]*))*$/);
  });

  it("still map to their GST codes", () => {
    for (const name of INDIAN_STATES) expect(gstStateCode(name)).toMatch(/^\d{2}$/);
  });
});
