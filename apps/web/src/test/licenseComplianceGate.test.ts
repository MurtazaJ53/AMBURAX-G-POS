import { describe, it, expect } from "vitest";
import { runLicenseAudit } from "../../../../scripts/licenseAudit";
import * as path from "node:path";

describe("Automated License Policy & Compliance Gate", () => {
  const repoRoot = path.resolve(__dirname, "../../../../");

  it("enforces zero unapproved copyleft and zero unapproved licenses", () => {
    const result = runLicenseAudit(repoRoot);

    expect(result.totalPackages).toBeGreaterThan(0);
    expect(result.prohibitedCount).toBe(0);
    expect(result.violations).toEqual([]);
  }, 120_000);

  it("verifies all approved exceptions have valid justifications", () => {
    const result = runLicenseAudit(repoRoot);

    for (const exp of result.exceptionsApproved) {
      expect(exp.reason.length).toBeGreaterThan(10);
      expect(exp.license).toBeDefined();
    }
  });

  it("ensures known permissive baseline forms majority of packages", () => {
    const result = runLicenseAudit(repoRoot);
    expect(result.permittedCount).toBeGreaterThanOrEqual(500);
  });
});
