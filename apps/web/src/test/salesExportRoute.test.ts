import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockList } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/sales/saleQueries", () => ({ listSalesForExport: mockList }));

const { GET } = await import("@/app/api/v1/sales/export/route");
const { env } = await import("@/lib/env");

const CONTEXT = {
  tenantId: "tenant-from-session",
  userId: "user-from-session",
  tenantRole: "STAFF" as const,
  storeId: "store-from-session",
  storeName: "Main",
  storeCode: "MAIN",
  membershipRole: "CASHIER",
  canSell: true,
};

function request(query = "", authenticated = true) {
  return new NextRequest(`http://localhost/api/v1/sales/export${query}`, {
    headers: authenticated ? { cookie: `${env.SESSION_COOKIE_NAME}=session-token` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
  mockList.mockResolvedValue({ status: "ok", rows: [] });
});

describe("GET /api/v1/sales/export", () => {
  it("requires a session", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "unauthorized" });
    expect((await GET(request("", false))).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("requires a store", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "no_store" });
    expect((await GET(request())).status).not.toBe(200);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("scopes to the session's tenant and store, ignoring scope ids in the query string", async () => {
    await GET(request("?tenantId=other&storeId=other&method=UPI"));
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-from-session", storeId: "store-from-session", method: "UPI" }),
    );
  });

  it("refuses an invalid filter with 400 before querying", async () => {
    const res = await GET(request("?status=DRAFT"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_filter");
    expect(mockList).not.toHaveBeenCalled();
  });

  it("refuses an oversized export with 422 rather than truncating", async () => {
    mockList.mockResolvedValue({ status: "too_many_rows", total: 5_001, max: 5_000 });
    const res = await GET(request());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("export_too_large");
    expect(body.error.message).toContain("5001");
  });

  it("returns an empty CSV (header only) for no matching sales", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="sales-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.replace(/^﻿/, "")).toBe("Bill Number,Date/Time (IST),Payment Method,Status,Subtotal,Tax,Discount,Total,Paid\r\n");
  });

  it("returns 503 without detail when the query fails", async () => {
    mockList.mockRejectedValue(new Error("db down: secret"));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
