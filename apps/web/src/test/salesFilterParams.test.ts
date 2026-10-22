import { describe, expect, it } from "vitest";
import { parseDate, parseSalesFiltersStrict } from "@/server/sales/salesFilterParams";

const strict = (params: Record<string, string>) => parseSalesFiltersStrict((name) => params[name] ?? null);

describe("parseSalesFiltersStrict", () => {
  it("accepts no filters", () => {
    expect(strict({})).toEqual({ ok: true, filters: { query: undefined, method: undefined, status: undefined, from: undefined, to: undefined } });
  });

  it("accepts valid filters and treats blank values as absent", () => {
    const res = strict({ q: " MAIN-0001 ", method: "UPI", status: "COMPLETED", from: "2026-10-01", to: "2026-10-12", ignored: "x" });
    expect(res).toEqual({
      ok: true,
      filters: { query: "MAIN-0001", method: "UPI", status: "COMPLETED", from: parseDate("2026-10-01"), to: parseDate("2026-10-12", true) },
    });
    expect(strict({ method: "  ", status: "" })).toMatchObject({ ok: true, filters: { method: undefined, status: undefined } });
  });

  it.each([
    [{ method: "BITCOIN" }, "method"],
    [{ method: "cash" }, "method"],
    [{ status: "DRAFT" }, "status"],
    [{ from: "2026-13-01" }, "from"],
    [{ from: "2026-02-31" }, "from"],
    [{ from: "12/10/2026" }, "from"],
    [{ to: "yesterday" }, "to"],
    [{ from: "2026-10-12", to: "2026-10-01" }, "range"],
    [{ q: "x".repeat(101) }, "q"],
  ])("refuses %j on %s rather than widening the export", (params, field) => {
    expect(strict(params as Record<string, string>)).toMatchObject({ ok: false, field });
  });

  it("accepts a single-day range (from = to)", () => {
    expect(strict({ from: "2026-10-12", to: "2026-10-12" }).ok).toBe(true);
  });
});
