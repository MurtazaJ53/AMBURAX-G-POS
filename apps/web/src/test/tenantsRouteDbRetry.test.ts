import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const registerBusiness = vi.fn();
vi.mock("@/server/tenant/registrationService", () => ({ registerBusiness }));
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

const { POST } = await import("@/app/api/v1/tenants/route");
const { withDbConnectionRetry } = await import("@/server/dbRetry");

function request() {
  return new Request("http://localhost/api/v1/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessName: "Retry Test Shop",
      businessType: "RETAIL",
      industry: "APPAREL",
      country: "IN",
      contactEmail: "retry@example.test",
      contactPhone: "9800000000",
      termsAccepted: true,
      idempotencyKey: "6f1d9430-0000-4000-8000-000000000001",
    }),
  }) as never;
}

const unreachable = () =>
  new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "5" });

const ok = { status: "ok", businessName: "Retry Test Shop", onboardingToken: "tok", expiresAt: new Date(0) };

beforeEach(() => registerBusiness.mockReset());

describe("POST /api/v1/tenants — database briefly unreachable (bug 16)", () => {
  it("retries once on a connection error and succeeds", async () => {
    registerBusiness.mockRejectedValueOnce(unreachable()).mockResolvedValueOnce(ok);
    const res = await POST(request());
    expect(registerBusiness).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(201);
  });

  it("gives up after the one retry", async () => {
    const work = vi.fn(async () => {
      throw unreachable();
    });
    await expect(withDbConnectionRetry(work, 0)).rejects.toThrow("Can't reach database server");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const work = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withDbConnectionRetry(work, 0)).rejects.toThrow("boom");
    expect(work).toHaveBeenCalledTimes(1);
  });
});
