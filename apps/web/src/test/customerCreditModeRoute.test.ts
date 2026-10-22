import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockGet, mockSet } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/khata/customerCreditOverride", () => ({
  getCustomerCreditMode: mockGet,
  setCustomerCreditMode: mockSet,
}));

const { GET, POST } = await import("@/app/api/v1/customers/[id]/credit-mode/route");
const { env } = await import("@/lib/env");

const CONTEXT = {
  tenantId: "tenant-from-session",
  userId: "owner-from-session",
  tenantRole: "OWNER" as const,
  storeId: "store-from-session",
  storeName: "Main",
  storeCode: "MAIN",
  membershipRole: null,
  canSell: true,
};

const VIEW = {
  companyId: "company-from-store",
  companyName: "Company A",
  currency: "INR",
  accountExists: true,
  mode: "UNLIMITED",
  limitMinor: null,
  source: "OWNER_OVERRIDE",
  setAt: new Date("2026-10-13T00:00:00.000Z"),
  companyDefault: { mode: "BLOCKED", limitMinor: null },
};

const params = { params: Promise.resolve({ id: "cust-1" }) };

function request(method: "GET" | "POST", body?: unknown, authenticated = true) {
  const headers: Record<string, string> = {};
  if (authenticated) headers.cookie = `${env.SESSION_COOKIE_NAME}=session-token`;
  if (method === "POST") headers["content-type"] = "application/json";
  return new NextRequest("http://localhost/api/v1/customers/cust-1/credit-mode", {
    method,
    headers,
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
  mockGet.mockResolvedValue({ status: "ok", view: VIEW });
  mockSet.mockResolvedValue({ status: "ok", view: VIEW, changed: true });
});

describe("/api/v1/customers/[id]/credit-mode", () => {
  it("requires a session", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "unauthorized" });
    expect((await GET(request("GET", undefined, false), params)).status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("reads with the session actor and the path customer only", async () => {
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith({ actor: CONTEXT, customerId: "cust-1" });
    expect((await res.json()).credit).toMatchObject({ mode: "UNLIMITED", source: "OWNER_OVERRIDE" });
  });

  it("passes mode and limit with the session actor", async () => {
    const res = await POST(request("POST", { mode: "LIMITED", limitMinor: 500_000, reason: "Owner approved" }), params);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      actor: CONTEXT,
      customerId: "cust-1",
      mode: "LIMITED",
      limitMinor: 500_000,
      reason: "Owner approved",
    }));
  });

  it.each([
    ["a client-supplied company id", { mode: "UNLIMITED", limitMinor: null, reason: "Owner approved", companyId: "other-company" }],
    ["a client-supplied tenant id", { mode: "UNLIMITED", limitMinor: null, reason: "Owner approved", tenantId: "other-tenant" }],
    ["an unknown mode", { mode: "OPEN", limitMinor: null, reason: "Owner approved" }],
    ["a fractional limit", { mode: "LIMITED", limitMinor: 10.5 }],
    ["a missing limit field", { mode: "UNLIMITED" }],
  ])("rejects %s before calling the service", async (_label, body) => {
    const res = await POST(request("POST", body), params);
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    expect((await POST(request("POST", "{not json"), params)).status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "forbidden" }, 403],
    [{ status: "company_unavailable" }, 409],
    [{ status: "not_found" }, 404],
    [{ status: "validation_error", reason: "no greater than" }, 400],
  ])("maps %j to %i", async (result, code) => {
    mockSet.mockResolvedValue(result);
    expect((await POST(request("POST", { mode: "BLOCKED", limitMinor: null, reason: "Owner approved" }), params)).status).toBe(code);
  });

  it("returns 503 without detail when the service throws", async () => {
    mockSet.mockRejectedValue(new Error("db down: secret detail"));
    const res = await POST(request("POST", { mode: "BLOCKED", limitMinor: null, reason: "Owner approved" }), params);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
