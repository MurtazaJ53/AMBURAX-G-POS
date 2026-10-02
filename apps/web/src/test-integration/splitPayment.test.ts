import { test, expect } from "vitest";
import { setupIntegrationEnvironment, getIds } from "./setup";
import { createSale } from "../server/sales/saleService";

let IDS: ReturnType<typeof getIds>;

test.beforeAll(async () => {
  const env = await setupIntegrationEnvironment();
  IDS = getIds();
});

test("Split Payments - Exactly matches total", async () => {
  const result = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: `split-exact-${Date.now()}`,
    lines: [{ variantId: IDS.variantA1, quantity: 2 }], // 2 * 1000 = 2000
    payments: [
      { method: "CASH", amountMinor: 1000 },
      { method: "UPI", amountMinor: 1000, reference: "txn_123" }
    ],
    correlationId: "corr-1",
  });
  
  if (result.status !== "ok") throw new Error("Expected ok, got " + result.status);
  
  expect(result.sale.totalMinor).toBe(2000);
  expect(result.sale.paidMinor).toBe(2000);
});

test("Split Payments - Insufficient sum fails", async () => {
  const result = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: `split-insuf-${Date.now()}`,
    lines: [{ variantId: IDS.variantA1, quantity: 2 }],
    payments: [
      { method: "CASH", amountMinor: 500 },
      { method: "UPI", amountMinor: 500 } // Total 1000, but due is 2000
    ],
    correlationId: "corr-2",
  });
  
  expect(result.status).toBe("validation_error");
});

test("Split Payments - Overpayment requires CASH", async () => {
  const result = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: `split-over-upi-${Date.now()}`,
    lines: [{ variantId: IDS.variantA1, quantity: 2 }],
    payments: [
      { method: "UPI", amountMinor: 2500 } // Total due 2000
    ],
    correlationId: "corr-3",
  });
  
  expect(result.status).toBe("validation_error");
  if (result.status === "validation_error") {
    expect(result.reason).toContain("Overpayment requires CASH");
  }
});

test("Split Payments - Overpayment works with CASH", async () => {
  const result = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: `split-over-cash-${Date.now()}`,
    lines: [{ variantId: IDS.variantA1, quantity: 2 }], // Total due 2000
    payments: [
      { method: "UPI", amountMinor: 1500 },
      { method: "CASH", amountMinor: 1000 } // Total 2500, but has CASH
    ],
    correlationId: "corr-4",
  });
  
  if (result.status !== "ok") throw new Error("Expected ok");
  
  // The system bounds paidMinor to totalMinor. The 500 overpayment is change.
  expect(result.sale.totalMinor).toBe(2000);
  expect(result.sale.paidMinor).toBe(2000);
});
