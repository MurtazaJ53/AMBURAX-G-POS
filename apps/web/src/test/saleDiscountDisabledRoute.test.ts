import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, mockCreateSale } = vi.hoisted(() => ({
  mockResolvePosContext: vi.fn(),
  mockCreateSale: vi.fn(),
}));

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/sales/saleService", () => ({ createSale: mockCreateSale }));

const { POST } = await import("@/app/api/v1/sales/route");
const { env } = await import("@/lib/env");

const CONTEXT = {
  tenantId: "tenant-from-session",
  userId: "cashier-from-session",
  tenantRole: "STAFF" as const,
  storeId: "store-from-session",
  storeName: "Main",
  storeCode: "MAIN",
  membershipRole: "CASHIER",
  canSell: true,
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/sales", {
    method: "POST",
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=session-token`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  idempotencyKey: "idem-discount-0001",
  lines: [{ variantId: "var-1", quantity: 1 }],
  payment: { method: "CASH" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
});

describe("POST /api/v1/sales with a discount", () => {
  it("maps discount_unavailable to a stable 409", async () => {
    mockCreateSale.mockResolvedValue({ status: "discount_unavailable" });
    const res = await POST(request({ ...BASE, discountMinor: 500 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("discount_unavailable");
    expect(mockCreateSale).toHaveBeenCalledWith(expect.objectContaining({ discountMinor: 500 }));
  });

  it("passes a missing discount through as zero, unchanged", async () => {
    mockCreateSale.mockResolvedValue({ status: "discount_unavailable" });
    await POST(request(BASE));
    expect(mockCreateSale).toHaveBeenCalledWith(expect.objectContaining({ discountMinor: 0 }));
  });

  it("passes the discount reason through and maps discount_not_allowed to 403", async () => {
    mockCreateSale.mockResolvedValue({
      status: "discount_not_allowed",
      reason: "Discounts above 10% need a store manager or owner.",
    });
    const res = await POST(request({ ...BASE, discountMinor: 5_000, discountReason: "Festival offer" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("discount_not_allowed");
    expect(body.error.message).toContain("store manager");
    expect(mockCreateSale).toHaveBeenCalledWith(
      expect.objectContaining({ discountMinor: 5_000, discountReason: "Festival offer" }),
    );
  });
});
