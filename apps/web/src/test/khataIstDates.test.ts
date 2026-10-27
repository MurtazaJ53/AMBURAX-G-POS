// Khata's business dates are India dates, whatever time zone the server runs in.
process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpResponse } from "@/server/erp/transport";

vi.mock("@/server/db", () => ({
  db: { customer: { findUnique: vi.fn(async () => ({ id: "c-1", name: "Asha", phone: null })) } },
}));
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
}));

const { ErpKhataService } = await import("@/server/khata/khataService");
const { istMonthStart } = await import("@/server/khata/khataBook");

const invoices = {
  data: [{ name: "SINV-1", customer: "Asha", outstanding_amount: 500, grand_total: 500, posting_date: "2026-10-20", due_date: "2026-10-26", status: "Unpaid" }],
};
const transport = { send: async (): Promise<ErpResponse> => ({ status: 200, body: invoices }) };

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-10-26 20:00 UTC = 2026-10-27 01:30 IST
  vi.setSystemTime(new Date("2026-10-26T20:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("khata dates in India time", () => {
  it("counts a bill due yesterday (IST) as overdue just after midnight IST", async () => {
    const service = new ErpKhataService(transport);
    vi.spyOn(service, "resolveErpCustomerName").mockResolvedValue("Asha");
    const due = await service.getCustomerReceivables({ tenantId: "t-1", customerId: "c-1" });
    expect(due.overdueMinor).toBe(50_000);
  });

  it("starts the month at midnight IST, not at the server's midnight", () => {
    // 2026-10-31 19:00 UTC is already 1 November in India.
    const now = new Date("2026-10-31T19:00:00.000Z");
    expect(istMonthStart(now, 0).toISOString()).toBe("2026-10-31T18:30:00.000Z"); // 1 Nov 00:00 IST
    expect(istMonthStart(now, 1).toISOString()).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 IST
    expect(istMonthStart(now, -1).toISOString()).toBe("2026-11-30T18:30:00.000Z"); // 1 Dec 00:00 IST
  });
});
