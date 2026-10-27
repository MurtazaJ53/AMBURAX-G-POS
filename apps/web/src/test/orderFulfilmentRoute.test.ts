import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The HTTP boundary of `POST /api/v1/orders/:id/fulfilment`. Recording fulfilment adds quantities,
 * so a repeated request would count the same goods twice; the order's version is what makes a
 * retry safe. `resolvePosContext` and `recordFulfilment` are mocked.
 */

const resolvePosContext = vi.fn();
const recordFulfilment = vi.fn();

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext }));
vi.mock("@/server/orders/orderService", async (orig) => ({ ...(await orig()), recordFulfilment }));

const { POST } = await import("@/app/api/v1/orders/[id]/fulfilment/route");
const { env } = await import("@/lib/env");

const CONTEXT = { tenantId: "t-1", userId: "u-1", tenantRole: "OWNER" as const, membershipRole: "OWNER", storeId: "s-1" };
const lines = [{ orderItemId: "oi-1", quantity: 2 }];

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/orders/o-1/fulfilment", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${env.SESSION_COOKIE_NAME}=session-token` },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "o-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  resolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
  recordFulfilment.mockResolvedValue({ status: "ok", order: { id: "o-1", version: 3 } });
});

describe("recording fulfilment over HTTP", () => {
  it("refuses a request without the order's version, so a retry can't count goods twice", async () => {
    const res = await POST(request({ lines }), params);
    expect(res.status).toBe(400);
    expect(recordFulfilment).not.toHaveBeenCalled();
  });

  it("passes the version through when it is given", async () => {
    const res = await POST(request({ lines, expectedVersion: 2 }), params);
    expect(res.status).toBeLessThan(300);
    expect(recordFulfilment).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 }));
  });
});
