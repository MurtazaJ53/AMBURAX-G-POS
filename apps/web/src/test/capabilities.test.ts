import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  Capability,
  DEFAULT_CAPABILITIES,
  isCapability,
} from "@/server/capability/capabilities";
import { canManageCapabilities } from "@/server/capability/capabilityService";

/**
 * The vocabulary and the administrative rule. Everything here is pure — the database side of
 * capabilities is proven against real PostgreSQL in `test-integration/capability.test.ts`,
 * because uniqueness, cascade and isolation are claims about the database, not about
 * TypeScript.
 */

describe("the capability vocabulary", () => {
  it("is exactly the seven capabilities the architecture names", () => {
    expect([...ALL_CAPABILITIES]).toEqual([
      "RETAIL",
      "WHOLESALE",
      "MANUFACTURING",
      "JOB_WORK",
      "PROCUREMENT",
      "COMMERCE",
      "DISTRIBUTION",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  /**
   * The identifiers are persisted in the database, compared in backend checks and written into
   * audit metadata. Renaming one is a data migration, so this test exists to make an accidental
   * rename fail loudly rather than quietly orphan every existing row.
   */
  it("uses stable uppercase identifiers, never display labels", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(capability).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it("recognises its own identifiers and nothing else", () => {
    expect(isCapability("RETAIL")).toBe(true);
    expect(isCapability("DISTRIBUTION")).toBe(true);

    expect(isCapability("retail")).toBe(false);
    expect(isCapability("Retail")).toBe(false);
    expect(isCapability("ORDERS")).toBe(false);
    expect(isCapability("")).toBe(false);
    expect(isCapability(null)).toBe(false);
    expect(isCapability(undefined)).toBe(false);
    expect(isCapability(1)).toBe(false);
    expect(isCapability({ capability: "RETAIL" })).toBe(false);
  });
});

describe("what a new tenant starts with", () => {
  /**
   * The backward-compatibility contract in one assertion. Every tenant can ring up a sale, so
   * RETAIL is granted; nothing else has an implementation behind it, so nothing else is.
   */
  it("is RETAIL and only RETAIL", () => {
    expect([...DEFAULT_CAPABILITIES]).toEqual([Capability.RETAIL]);
  });

  it("grants nothing that has no implementation behind it", () => {
    for (const capability of [
      Capability.WHOLESALE,
      Capability.MANUFACTURING,
      Capability.JOB_WORK,
      Capability.PROCUREMENT,
      Capability.COMMERCE,
      Capability.DISTRIBUTION,
    ]) {
      expect(DEFAULT_CAPABILITIES).not.toContain(capability);
    }
  });

  it("only contains real capabilities", () => {
    for (const capability of DEFAULT_CAPABILITIES) {
      expect(ALL_CAPABILITIES).toContain(capability);
    }
  });
});

describe("who may change capability configuration", () => {
  it("allows the tenant owner", () => {
    expect(canManageCapabilities({ tenantRole: "OWNER" })).toBe(true);
  });

  /**
   * Staff are refused regardless of any store role they hold. A capability is company-wide
   * configuration, so it is not reachable through a store membership — which is exactly the
   * difference between this check and `canManageInventory`, where a STORE_MANAGER qualifies.
   */
  it("refuses staff", () => {
    expect(canManageCapabilities({ tenantRole: "STAFF" })).toBe(false);
  });
});
