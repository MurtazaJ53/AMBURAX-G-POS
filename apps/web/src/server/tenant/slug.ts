import { randomBytes } from "node:crypto";

/**
 * Business names are not unique (many "Sharma Traders" can legitimately exist), so the
 * slug — which IS unique — is a normalized name plus a short random suffix, not the raw
 * name. Callers should retry with a fresh call on a unique-constraint collision; the
 * suffix space (36^6) makes a second collision astronomically unlikely.
 */
export function generateTenantSlug(businessName: string): string {
  const base =
    businessName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business";
  const suffix = randomBytes(4).toString("hex").slice(0, 6);
  return `${base}-${suffix}`;
}
