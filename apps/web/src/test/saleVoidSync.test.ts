import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRequest, ErpResponse } from "@/server/erp/transport";

// A voided bill must cancel its own ERPNext Sales Invoice. It used to queue SaleReturnCreated with
// the sale's id, which the return adapter can't find: the event retried for up to a day, blocking
// every later event for the shop, then dead-lettered with the invoice still live.

const enqueueOutboxEvent = vi.fn(async () => {});
const mockTx = { sale: { update: vi.fn() }, salePayment: { updateMany: vi.fn() } };
const mockDb = {
  sale: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};
vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent }));
vi.mock("@/server/inventory/stockLedger", () => ({ applyStockMovement: vi.fn(async () => {}), movementKey: {} }));
vi.mock("@/server/identity/approvalPin", () => ({ verifyApprovalPin: vi.fn(), listApprovers: vi.fn() }));
vi.mock("@/server/erp/config", () => ({
  resolveErpEnvironment: vi.fn(async () => ({
    status: "ok",
    environment: { tenantId: "t-1", siteId: "frontend", clusterId: null, companyId: "Test Co", version: null },
  })),
  EnvErpCredentialProvider: class {
    async credentialsFor() {
      return { baseUrl: "http://erp.test.invalid", apiKey: "k", apiSecret: "s" };
    }
  },
  ProvisionerErpCredentialProvider: class {},
}));

const { cancelSale } = await import("@/server/sales/saleCancelService");
const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
const { ErpOutboxPublisher } = await import("@/server/erp/outboxPublisher");

const voided = { id: "sale-1", tenantId: "t-1", storeId: "s-1", status: "VOIDED" };

function erp(invoices: Array<{ name: string; docstatus: number }>) {
  const writes: ErpRequest[] = [];
  const transport = {
    async send(request: ErpRequest): Promise<ErpResponse> {
      if (request.method === "GET") return { status: 200, body: { data: invoices } };
      writes.push(request);
      return { status: 200, body: { message: "ok" } };
    },
  };
  return { transport, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voiding a bill", () => {
  it("queues SaleVoided for the sale, not a return that doesn't exist", async () => {
    mockDb.sale.findUnique.mockResolvedValue({
      id: "sale-1", tenantId: "t-1", storeId: "s-1", status: "COMPLETED", completedAt: new Date(),
      items: [{ id: "i-1", variantId: "v-1", quantity: 1 }], payments: [], returns: [],
    });
    mockTx.sale.update.mockResolvedValue({ id: "sale-1", status: "VOIDED" });
    await cancelSale({ tenantId: "t-1", storeId: "s-1", saleId: "sale-1", reason: "wrong item", actor: { userId: "u-1", tenantRole: "OWNER", membershipRole: null } });
    expect(enqueueOutboxEvent).toHaveBeenCalledWith(mockTx, expect.objectContaining({ eventType: "SaleVoided", entityId: "sale-1" }));
    expect(enqueueOutboxEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "SaleReturnCreated" }));
  });

  it("routes SaleVoided to the sale adapter's invoice cancellation", async () => {
    const saleAdapter = { cancelInvoice: vi.fn(async () => {}) };
    const publisher = new ErpOutboxPublisher(saleAdapter as never);
    await publisher.publish({ eventType: "SaleVoided", tenantId: "t-1", entityId: "sale-1", correlationId: "c-1" } as never);
    expect(saleAdapter.cancelInvoice).toHaveBeenCalledWith("t-1", "sale-1", "c-1");
  });
});

describe("cancelling the ERPNext invoice of a voided bill", () => {
  beforeEach(() => mockDb.sale.findUnique.mockResolvedValue(voided));

  it("cancels a submitted invoice", async () => {
    const { transport, writes } = erp([{ name: "SINV-0001", docstatus: 1 }]);
    await new ErpSaleAdapter(transport).cancelInvoice("t-1", "sale-1", "c-1");
    expect(writes).toEqual([
      expect.objectContaining({ method: "POST", path: "/api/method/frappe.client.cancel", body: { doctype: "Sales Invoice", name: "SINV-0001" } }),
    ]);
  });

  // Never delete: a delete right would also let the integration erase cancelled invoices. A draft
  // touches neither stock nor ledger, so moving its id aside and noting the void is enough.
  it("moves a draft invoice's id aside and notes the void, never deleting it", async () => {
    const writes: ErpRequest[] = [];
    const transport = {
      async send(request: ErpRequest): Promise<ErpResponse> {
        if (request.method === "GET" && request.path.includes("VOIDED")) {
          return { status: 200, body: { data: [{ amburax_sale_id: "sale-1-VOIDED-1" }] } };
        }
        if (request.method === "GET") return { status: 200, body: { data: [{ name: "SINV-0002", docstatus: 0, remarks: "Counter sale" }] } };
        writes.push(request);
        return { status: 200, body: { data: {} } };
      },
    };
    await new ErpSaleAdapter(transport).cancelInvoice("t-1", "sale-1", "c-1");
    expect(writes).toEqual([
      expect.objectContaining({
        method: "PUT",
        path: "/api/resource/Sales Invoice/SINV-0002",
        body: { amburax_sale_id: "sale-1-VOIDED-2", remarks: "Counter sale\nVoided in G-POS" },
      }),
    ]);
  });

  it("does nothing when the invoice is already cancelled or was never created", async () => {
    for (const invoices of [[{ name: "SINV-0003", docstatus: 2 }], []]) {
      const { transport, writes } = erp(invoices);
      await new ErpSaleAdapter(transport).cancelInvoice("t-1", "sale-1", "c-1");
      expect(writes).toEqual([]);
    }
  });

  it("refuses to cancel the invoice of a bill that isn't voided", async () => {
    mockDb.sale.findUnique.mockResolvedValue({ ...voided, status: "COMPLETED" });
    const { transport, writes } = erp([{ name: "SINV-0004", docstatus: 1 }]);
    await expect(new ErpSaleAdapter(transport).cancelInvoice("t-1", "sale-1", "c-1")).rejects.toThrow(/not voided/);
    expect(writes).toEqual([]);
  });
});

describe("a voided bill whose invoice has a payment linked", () => {
  beforeEach(() => mockDb.sale.findUnique.mockResolvedValue(voided));

  // ERPNext refuses with LinkExistsError (HTTP 417); the message below is v16's, captured on scratch. Retrying can't help, so the event must fail at
  // once with a reason the owner can act on, and the payment must never be touched by us.
  function linkedPaymentErp() {
    const writes: ErpRequest[] = [];
    const transport = {
      async send(request: ErpRequest): Promise<ErpResponse> {
        if (request.method === "GET") return { status: 200, body: { data: [{ name: "SINV-0005", docstatus: 1 }] } };
        writes.push(request);
        return {
          status: 417,
          body: {
            exc_type: "LinkExistsError",
            _server_messages: JSON.stringify([
              JSON.stringify({
                message:
                  'Cannot delete or cancel because Sales Invoice <a href="http://scratch.local/desk/sales-invoice/SINV-0005">SINV-0005</a> is linked with Payment Entry <a href="http://scratch.local/desk/payment-entry/ACC-PAY-2026-00007">ACC-PAY-2026-00007</a> at Row: 1',
              }),
            ]),
          },
        };
      },
    };
    return { transport, writes };
  }

  it("fails without retry, naming the payment to unlink", async () => {
    const { transport, writes } = linkedPaymentErp();
    const failure = await new ErpSaleAdapter(transport).cancelInvoice("t-1", "sale-1", "c-1").catch((e) => e);
    expect(failure.retryable).toBe(false);
    expect(failure.message).toBe(
      "Payment ACC-PAY-2026-00007 is linked to Sales Invoice SINV-0005; unlink it in ERPNext, then retry.",
    );
    // Only the cancel was attempted: nothing was sent to the Payment Entry.
    expect(writes).toHaveLength(1);
    expect(writes.some((w) => w.path.includes("Payment Entry"))).toBe(false);
  });
});
