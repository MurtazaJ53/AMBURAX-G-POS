import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRequest, ErpResponse, ErpTransport } from "@/server/erp/transport";

const mockSaleDb = {
  sale: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/server/db", () => ({ db: mockSaleDb }));

vi.mock("@/server/erp/config", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveErpEnvironment: vi.fn().mockResolvedValue({
      status: "ok",
      environment: { siteId: "scratch.local", tenantId: "t-1", companyId: "SKF" },
    }),
    EnvErpCredentialProvider: class {
      async credentialsFor() {
        return { baseUrl: "http://erp.local", apiKey: "k", apiSecret: "s" };
      }
    },
    ProvisionerErpCredentialProvider: class {},
  };
});

const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
const { ErpOutboxPublisher } = await import("@/server/erp/outboxPublisher");

describe("outboxRedriveReplaySafety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaleDb.tenant.findUnique.mockResolvedValue({ erpnextSiteId: "scratch.local" });
    mockSaleDb.sale.update.mockResolvedValue({});
  });

  it("re-driven SaleCompleted finds existing invoice by amburax_sale_id and does not create a duplicate", async () => {
    mockSaleDb.sale.findUnique.mockResolvedValue({
      id: "sale-redrive-101",
      tenantId: "t-1",
      storeId: "store-1",
      status: "COMPLETED",
      completedAt: new Date("2026-10-30T10:00:00.000Z"),
      invoiceNumber: "INV-101",
      customer: null,
      totalMinor: 10000,
      discountMinor: 0,
      taxMinor: 0,
      items: [
        {
          id: "item-1",
          variantId: "v-1",
          quantity: 1,
          unitPriceMinor: 10000,
          discountMinor: 0,
          taxAmountMinor: 0,
        },
      ],
      payments: [{ method: "CASH", amountMinor: 10000 }],
      tenant: { taxId: null },
    });

    const requests: ErpRequest[] = [];
    const mockTransport: ErpTransport = {
      async send(req: ErpRequest): Promise<ErpResponse> {
        requests.push(req);
        const decodedPath = decodeURIComponent(req.path);

        // When lookupInvoiceBySaleId queries for existing Sales Invoice
        if (req.method === "GET" && decodedPath.includes("/api/resource/Sales Invoice?filters=")) {
          return {
            status: 200,
            body: {
              data: [
                {
                  name: "ACC-SINV-EXISTING-101",
                  docstatus: 1, // Already submitted in ERPNext!
                  currency: "INR",
                  price_list_currency: "INR",
                  conversion_rate: 1,
                  plc_conversion_rate: 1,
                  amburax_sale_id: "sale-redrive-101",
                },
              ],
            },
          };
        }

        return { status: 200, body: { data: {} } };
      },
    };

    const saleAdapter = new ErpSaleAdapter(mockTransport);
    const publisher = new ErpOutboxPublisher(saleAdapter as never);

    // Event is published / re-driven through ErpOutboxPublisher
    await publisher.publish({
      eventId: "evt-redrive-1",
      eventType: "SaleCompleted",
      eventVersion: 1,
      occurredAt: new Date("2026-10-30T10:00:00.000Z"),
      tenantId: "t-1",
      storeId: "store-1",
      actorUserId: "user-1",
      correlationId: "corr-redrive-1",
      causationId: null,
      entityId: "sale-redrive-101",
      payload: {},
    });

    // Check requests made:
    // 1. Should have called GET on Sales Invoice with amburax_sale_id filter
    const getInvoiceCall = requests.find(
      (r) => r.method === "GET" && decodeURIComponent(r.path).includes("amburax_sale_id")
    );
    expect(getInvoiceCall).toBeDefined();

    // 2. Should NOT have called POST /api/resource/Sales Invoice (no duplicate invoice created)
    const postInvoiceCall = requests.find(
      (r) => r.method === "POST" && r.path === "/api/resource/Sales Invoice"
    );
    expect(postInvoiceCall).toBeUndefined();

    // 3. AMBURAX DB record is updated with existing ERPNext invoice ID
    expect(mockSaleDb.sale.update).toHaveBeenCalledWith({
      where: { id: "sale-redrive-101" },
      data: {
        erpInvoiceId: "ACC-SINV-EXISTING-101",
        erpSyncStatus: "SYNCED",
      },
    });
  });
});
