import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The HTTP boundary of `POST /api/v1/pos/devices`.
 *
 * The domain operation is tested against real PostgreSQL in `posDeviceCreate.test.ts`; what is
 * tested here is only what the boundary itself decides — who is turned away, which refusal wears
 * which status, what a client is allowed to say, and what comes back. Those are separate
 * questions from whether a device row is correct, and a boundary that answers them wrongly is a
 * security bug even when the domain beneath it is perfect.
 *
 * `resolvePosContext` and `createPosDevice` are mocked, so a failure here is a failure of the
 * route and nothing else.
 */

const resolvePosContext = vi.fn();
const createPosDevice = vi.fn();

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext }));
vi.mock("@/server/pos/posDeviceQueries", () => ({ listPosDevices: vi.fn() }));
vi.mock("@/server/pos/posDeviceProvisioning", () => ({ createPosDevice }));

const { POST } = await import("@/app/api/v1/pos/devices/route");
const { env } = await import("@/lib/env");

const CONTEXT = {
  tenantId: "t-real",
  userId: "u-owner",
  tenantRole: "OWNER" as const,
  membershipRole: "OWNER",
  storeId: "s-real",
};

function request(body: unknown, opts: { authenticated?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.authenticated !== false) {
    headers.cookie = `${env.SESSION_COOKIE_NAME}=session-token`;
  }
  // A real NextRequest, not a plain Request: the route reads `req.cookies`, which only the
  // Next wrapper provides. Faking it would let the test pass over a route that cannot run.
  return new NextRequest("http://localhost/api/v1/pos/devices", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const OK_RESULT = {
  status: "ok",
  device: {
    id: "d-1",
    name: "Counter 2",
    code: "POS-02",
    storeId: "s-real",
    status: "PENDING_ACTIVATION",
  },
  pairingCode: "ABCD-1234",
  pairingExpiresAt: new Date("2026-09-16T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
  createPosDevice.mockResolvedValue(OK_RESULT);
});

describe("POST /api/v1/pos/devices", () => {
  it("turns an anonymous caller away before reaching the domain at all", async () => {
    resolvePosContext.mockResolvedValue({ status: "unauthorized" });

    const res = await POST(
      request({ name: "Counter 2", code: "POS-02" }, { authenticated: false }),
    );
    expect(res.status).toBe(401);
    // Not merely refused — never called. An unauthenticated request must not reach a write.
    expect(createPosDevice).not.toHaveBeenCalled();
  });

  it("refuses a caller whose role may not configure a terminal", async () => {
    createPosDevice.mockResolvedValue({ status: "forbidden" });

    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("ignores a tenantId or storeId a client tries to supply", async () => {
    const res = await POST(
      request({
        name: "Counter 2",
        code: "POS-02",
        tenantId: "t-someone-else",
        storeId: "s-someone-else",
      }),
    );
    expect(res.status).toBe(201);

    // The body's identifiers reach nothing: the actor is built from the session alone. This is
    // the whole isolation posture of the endpoint, stated as an assertion.
    const call = createPosDevice.mock.calls[0]![0];
    expect(call.actor).toEqual(CONTEXT);
    expect(JSON.stringify(call)).not.toContain("someone-else");
  });

  it("returns the terminal and a one-time pairing code, and no credential material", async () => {
    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.device).toEqual(OK_RESULT.device);
    expect(body.pairingCode).toBe("ABCD-1234");
    expect(body.pairingExpiresAt).toBe("2026-09-16T10:00:00.000Z");

    // The pairing code is shown once, deliberately. Everything else that could authenticate a
    // device must be absent — a hash is not "safe because it is hashed".
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("pairingCodeHash");
    expect(serialized).not.toContain("deviceSecretHash");
    expect(serialized).not.toContain("passwordHash");
    expect(body.device).not.toHaveProperty("pairingCodeHash");
    expect(body.device).not.toHaveProperty("deviceSecretHash");
  });

  it("answers a disabled capability as an unknown route, not as a refusal", async () => {
    createPosDevice.mockResolvedValue({ status: "capability_disabled", capability: "RETAIL" });

    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    // Per the P1-7 freeze: whether a tenant has a module is not something their API volunteers.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(JSON.stringify(body)).not.toContain("RETAIL");
  });

  it("reports a taken code as a conflict", async () => {
    createPosDevice.mockResolvedValue({
      status: "conflict",
      reason: "A terminal with the code POS-02 already exists in this store.",
    });

    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "conflict" } });
  });

  it("rejects a malformed body without calling the domain", async () => {
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(createPosDevice).not.toHaveBeenCalled();
  });

  it("rejects a body missing a name or code before it reaches the domain", async () => {
    const res = await POST(request({ code: "POS-02" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "validation_error" } });
    expect(createPosDevice).not.toHaveBeenCalled();
  });

  it("answers a caller with no store the same way the list does", async () => {
    resolvePosContext.mockResolvedValue({ status: "no_store" });

    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    expect(res.status).toBe(409);
    expect(createPosDevice).not.toHaveBeenCalled();
  });

  it("does not leak the underlying error when the domain throws", async () => {
    createPosDevice.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:55432"));

    const res = await POST(request({ name: "Counter 2", code: "POS-02" }));
    expect(res.status).toBe(503);
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("55432");
  });
});
