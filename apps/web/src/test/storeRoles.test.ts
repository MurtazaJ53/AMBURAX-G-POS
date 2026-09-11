import { describe, expect, it } from "vitest";
import { isInvitableStoreRole, INVITABLE_STORE_ROLES } from "@/server/tenant/storeRoles";

describe("isInvitableStoreRole", () => {
  it("accepts every documented invitable role", () => {
    for (const role of INVITABLE_STORE_ROLES) {
      expect(isInvitableStoreRole(role)).toBe(true);
    }
  });

  it("rejects OWNER — tenant ownership is never granted through an invitation payload", () => {
    expect(isInvitableStoreRole("OWNER")).toBe(false);
  });

  it("rejects an arbitrary/unknown role string", () => {
    expect(isInvitableStoreRole("PLATFORM_ADMIN")).toBe(false);
    expect(isInvitableStoreRole("")).toBe(false);
  });
});
