import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

import { MAX_REPORT_DAYS, canViewReports, resolveReportRange } from "@/server/reports/salesReport";

// 13 Oct 2026, 15:00 IST.
const NOW = new Date("2026-10-13T09:30:00Z");

describe("resolveReportRange", () => {
  it("defaults to the last 7 trading days ending today", () => {
    const r = resolveReportRange({}, NOW);
    expect(r).toMatchObject({ fromKey: "2026-10-07", toKey: "2026-10-13", days: 7, clamped: false });
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86_400_000);
  });

  it("starts each day at midnight store time", () => {
    const r = resolveReportRange({ from: "2026-10-01", to: "2026-10-01" }, NOW);
    expect(r.from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(r.days).toBe(1);
  });

  it("swaps a reversed range and pulls a future end back to today", () => {
    expect(resolveReportRange({ from: "2026-10-10", to: "2026-10-01" }, NOW)).toMatchObject({
      fromKey: "2026-10-01",
      toKey: "2026-10-10",
    });
    expect(resolveReportRange({ from: "2026-10-12", to: "2026-12-31" }, NOW).toKey).toBe("2026-10-13");
  });

  it("ignores malformed and impossible dates", () => {
    expect(resolveReportRange({ from: "2026-02-30", to: "garbage" }, NOW)).toMatchObject({
      fromKey: "2026-10-07",
      toKey: "2026-10-13",
    });
  });

  it("clamps a range longer than the maximum to its last days", () => {
    const r = resolveReportRange({ from: "2025-01-01", to: "2026-10-13" }, NOW);
    expect(r.days).toBe(MAX_REPORT_DAYS);
    expect(r.clamped).toBe(true);
    expect(r.toKey).toBe("2026-10-13");
  });
});

describe("canViewReports", () => {
  it("allows a tenant owner and a store manager only", () => {
    expect(canViewReports({ tenantRole: "OWNER", membershipRole: null })).toBe(true);
    expect(canViewReports({ tenantRole: "STAFF", membershipRole: "STORE_MANAGER" })).toBe(true);
    expect(canViewReports({ tenantRole: "STAFF", membershipRole: "CASHIER" })).toBe(false);
  });
});
