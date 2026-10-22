import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockGetDefault, mockSetDefault } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockGetDefault: vi.fn(),
  mockSetDefault: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/khata/companyCreditSettings", () => ({
  getCompanyCreditDefault: mockGetDefault,
  setCompanyCreditDefault: mockSetDefault,
}));

const { GET, POST } = await import("@/app/api/v1/settings/credit-default/route");
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

function request(method: "GET" | "POST", body?: unknown, authenticated = true) {
  const headers: Record<string, string> = {};
  if (authenticated) headers.cookie = `${env.SESSION_COOKIE_NAME}=session-token`;
  if (method === "POST") headers["content-type"] = "application/json";
  return new NextRequest("http://localhost/api/v1/settings/credit-default", {
    method,
    headers,
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
  mockGetDefault.mockResolvedValue({
    status: "ok",
    companyId: "company-from-store",
    companyName: "Company A",
    currency: "INR",
    mode: "BLOCKED",
    limitMinor: null,
  });
  mockSetDefault.mockResolvedValue({ status: "ok", companyId: "company-from-store", companyName: "Company A", currency: "INR", mode: "UNLIMITED", limitMinor: null, changed: true });
});

describe("/api/v1/settings/credit-default", () => {
  it("requires an authenticated session before reading", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "unauthorized" });
    const response = await GET(request("GET", undefined, false));
    expect(response.status).toBe(401);
    expect(mockGetDefault).not.toHaveBeenCalled();
  });

  it("passes only server-resolved tenant, user, role, and store to the setting service", async () => {
    await GET(request("GET"));
    expect(mockGetDefault).toHaveBeenCalledWith(CONTEXT);
  });

  it("rejects client-supplied scope identifiers", async () => {
    const response = await POST(request("POST", {
      mode: "UNLIMITED",
      limitMinor: null,
      tenantId: "tenant-attacker",
      companyId: "company-attacker",
      storeId: "store-attacker",
    }));
    expect(response.status).toBe(400);
    expect(mockSetDefault).not.toHaveBeenCalled();
  });

  it("posts only the chosen mode and limit with the resolved actor", async () => {
    const response = await POST(request("POST", { mode: "UNLIMITED", limitMinor: null }));
    expect(response.status).toBe(200);
    expect(mockSetDefault).toHaveBeenCalledWith({
      actor: CONTEXT,
      mode: "UNLIMITED",
      limitMinor: null,
      correlationId: expect.any(String),
    });
  });

  it("maps an owner-only refusal to HTTP 403", async () => {
    mockSetDefault.mockResolvedValue({ status: "forbidden" });
    const response = await POST(request("POST", { mode: "BLOCKED", limitMinor: null }));
    expect(response.status).toBe(403);
  });
});
