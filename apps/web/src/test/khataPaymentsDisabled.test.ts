import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockResolvePosContext, dbMock } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockResolvePosContext: vi.fn(),
    dbMock: {
      customer: { findUnique: fn() },
      store: { findFirst: fn() },
      khataPayment: { findUnique: fn(), create: fn() },
      outboxEvent: { create: fn() },
      $transaction: fn(),
    },
  };
});

vi.mock("@/server/sales/posContext", () => ({ resolvePosContext: mockResolvePosContext }));
vi.mock("@/server/db", () => ({ db: dbMock }));
const mockCollect = vi.fn();
vi.mock("@/server/khata/repayment", () => ({ collectRepayment: mockCollect }));

const { POST } = await import("@/app/api/v1/khata/payments/route");
const { ErpKhataService, KhataPaymentsUnavailableError } = await import("@/server/khata/khataService");
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

const VALID_BODY = { customerId: "cust-1", amountMinor: 50_000, paymentMethod: "UPI", idempotencyKey: "idem-khata-0001" };

const SERVICE_INPUT = {
  tenantId: "tenant-a",
  customerId: "cust-1",
  actorUserId: "user-1",
  storeId: "store-a",
  amountMinor: 1_000,
  idempotencyKey: "idem-direct-0001",
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/khata/payments", {
    method: "POST",
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=session-token`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectNoDatabaseAccess() {
  expect(dbMock.customer.findUnique).not.toHaveBeenCalled();
  expect(dbMock.store.findFirst).not.toHaveBeenCalled();
  expect(dbMock.khataPayment.findUnique).not.toHaveBeenCalled();
  expect(dbMock.khataPayment.create).not.toHaveBeenCalled();
  expect(dbMock.outboxEvent.create).not.toHaveBeenCalled();
  expect(dbMock.$transaction).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePosContext.mockResolvedValue({ status: "ok", context: CONTEXT });
});

describe("Khata payment collection", () => {
  // Q6/Q7 (owner 2026-10-14): the route now collects through the FIFO repayment ledger, scoped by
  // the session, never by the body. The old unallocated service method below stays switched off.
  it("POST /api/v1/khata/payments collects through FIFO repayment with the session's tenant and store", async () => {
    mockCollect.mockResolvedValue({ status: "ok", paymentId: "p1", appliedMinor: 50_000, changeMinor: 0, allocations: [], remainingMinor: 0, duplicate: false });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockCollect).toHaveBeenCalledWith(expect.objectContaining({
      actor: { tenantId: "tenant-from-session", userId: "owner-from-session" },
      storeId: "store-from-session",
      customerId: "cust-1",
      method: "UPI",
      tenderedMinor: 50_000,
    }));
  });

  it("refuses a body that tries to name its own tenant or store", async () => {
    expect((await POST(request({ ...VALID_BODY, tenantId: "other" }))).status).toBe(400);
    expect((await POST(request({ ...VALID_BODY, storeId: "other" }))).status).toBe(400);
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("still requires a session first", async () => {
    mockResolvePosContext.mockResolvedValue({ status: "unauthorized" });
    expect((await POST(request(VALID_BODY))).status).toBe(401);
    expectNoDatabaseAccess();
  });

  it("the legacy unallocated service method still refuses, so nothing can record an unallocated payment", async () => {
    await expect(new ErpKhataService().collectCustomerPayment(SERVICE_INPUT)).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);
    expectNoDatabaseAccess();
  });

  it("refuses even a replay of an idempotency key that already exists", async () => {
    dbMock.khataPayment.findUnique.mockResolvedValue({ id: "existing-payment" });
    await expect(
      new ErpKhataService().collectCustomerPayment({ ...SERVICE_INPUT, idempotencyKey: "idem-existing-0001" }),
    ).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);
    expectNoDatabaseAccess();
  });
});
