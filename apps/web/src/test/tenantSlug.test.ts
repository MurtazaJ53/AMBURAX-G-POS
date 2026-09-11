import { describe, expect, it } from "vitest";
import { generateTenantSlug } from "@/server/tenant/slug";

describe("generateTenantSlug", () => {
  it("normalizes the business name to lowercase kebab-case", () => {
    const slug = generateTenantSlug("Sharma Traders & Co.");
    expect(slug).toMatch(/^sharma-traders-co-[0-9a-f]{6}$/);
  });

  it("produces a different slug on every call, even for the same name", () => {
    const a = generateTenantSlug("Acme Retail");
    const b = generateTenantSlug("Acme Retail");
    expect(a).not.toBe(b);
  });

  it("falls back to a safe default for a name with no alphanumeric characters", () => {
    const slug = generateTenantSlug("!!!");
    expect(slug).toMatch(/^business-[0-9a-f]{6}$/);
  });

  it("truncates very long business names", () => {
    const slug = generateTenantSlug("a".repeat(200));
    expect(slug.length).toBeLessThan(60);
  });
});
