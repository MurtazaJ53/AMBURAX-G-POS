import { describe, expect, it } from "vitest";
import { normalizeAddress, type AddressInput } from "@/server/address/addressService";

/**
 * Address validation and normalisation, which is pure and therefore testable without a database.
 *
 * Tenant isolation, the composite foreign keys and the default-address contract are proven
 * against real PostgreSQL in `src/test-integration/address.test.ts`.
 */

function address(over: Partial<AddressInput> = {}): AddressInput {
  return {
    line1: "12 Ring Road",
    city: "Ahmedabad",
    state: "Gujarat",
    postalCode: "380001",
    country: "IN",
    type: "SHIPPING",
    ...over,
  };
}

describe("required fields", () => {
  it("accepts a complete address", () => {
    const result = normalizeAddress(address());
    expect("status" in result).toBe(false);
  });

  for (const field of ["line1", "city", "state", "postalCode", "country"] as const) {
    it(`rejects a missing ${field}`, () => {
      const result = normalizeAddress(address({ [field]: "" }));
      expect(result).toMatchObject({ status: "validation_error", field });
    });

    it(`rejects a whitespace-only ${field}`, () => {
      // "   " is not a city. Trimming first is what makes the emptiness visible.
      const result = normalizeAddress(address({ [field]: "   " }));
      expect(result).toMatchObject({ status: "validation_error", field });
    });
  }
});

describe("normalisation", () => {
  it("collapses runs of whitespace and trims", () => {
    const result = normalizeAddress(address({ line1: "  12   Ring    Road  " }));
    expect(result).toMatchObject({ line1: "12 Ring Road" });
  });

  it("uppercases the country code", () => {
    expect(normalizeAddress(address({ country: "in" }))).toMatchObject({ country: "IN" });
  });

  it("uppercases the postal code, so a Canadian one has a single spelling", () => {
    expect(normalizeAddress(address({ postalCode: "k1a 0b1", country: "CA" }))).toMatchObject({
      postalCode: "K1A 0B1",
    });
  });

  it("turns an empty optional field into null rather than an empty string", () => {
    const result = normalizeAddress(address({ line2: "  ", contactName: "", contactPhone: "" }));
    expect(result).toMatchObject({ line2: null, contactName: null, contactPhone: null });
  });
});

describe("country", () => {
  it("requires the two-letter code, not the country name", () => {
    // The one strict field: later tax and shipping logic branches on it, and a free-text mix of
    // "India" / "IN" / "Bharat" would make that impossible.
    expect(normalizeAddress(address({ country: "India" }))).toMatchObject({
      status: "validation_error",
      field: "country",
    });
  });

  it("rejects digits in the country code", () => {
    expect(normalizeAddress(address({ country: "I1" }))).toMatchObject({
      status: "validation_error",
      field: "country",
    });
  });
});

describe("postal code stays international", () => {
  it("accepts an Indian PIN", () => {
    expect(normalizeAddress(address({ postalCode: "380001" }))).toMatchObject({
      postalCode: "380001",
    });
  });

  it("accepts a Canadian postal code with a space", () => {
    expect(normalizeAddress(address({ postalCode: "K1A 0B1", country: "CA" }))).toMatchObject({
      postalCode: "K1A 0B1",
    });
  });

  it("accepts a hyphenated code", () => {
    expect(normalizeAddress(address({ postalCode: "12345-6789", country: "US" }))).toMatchObject({
      postalCode: "12345-6789",
    });
  });

  it("rejects punctuation that is not part of any postal format", () => {
    expect(normalizeAddress(address({ postalCode: "380@01" }))).toMatchObject({
      status: "validation_error",
      field: "postalCode",
    });
  });
});

describe("lengths and optional fields", () => {
  it("rejects an overlong street line", () => {
    expect(normalizeAddress(address({ line1: "x".repeat(201) }))).toMatchObject({
      status: "validation_error",
      field: "line1",
    });
  });

  it("rejects an overlong second line", () => {
    expect(normalizeAddress(address({ line2: "x".repeat(201) }))).toMatchObject({
      status: "validation_error",
      field: "line2",
    });
  });

  it("accepts a plausible contact phone", () => {
    expect(normalizeAddress(address({ contactPhone: "+91 98765 43210" }))).toMatchObject({
      contactPhone: "+91 98765 43210",
    });
  });

  it("rejects letters in a phone number", () => {
    expect(normalizeAddress(address({ contactPhone: "call me" }))).toMatchObject({
      status: "validation_error",
      field: "contactPhone",
    });
  });
});

describe("address type", () => {
  for (const type of ["BILLING", "SHIPPING", "BOTH"] as const) {
    it(`carries ${type} through unchanged`, () => {
      expect(normalizeAddress(address({ type }))).toMatchObject({ type });
    });
  }
});
