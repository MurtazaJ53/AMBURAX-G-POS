const fs = require("fs");
let content = fs.readFileSync("apps/web/src/test-integration/sales.test.ts", "utf-8");
const newTests = `
  describe("Split Payments", () => {
    it("Exactly matches total", async () => {
      // Create a sale to find total
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`trial-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-1",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`split-exact-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payments: [
          { method: "CASH", amountMinor: total / 2 },
          { method: "UPI", amountMinor: total / 2, reference: "txn_123" }
        ],
        correlationId: "corr-1",
      });
      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.sale.totalMinor).toBe(total);
        expect(res.sale.paidMinor).toBe(total);
      }
    });

    it("Insufficient sum fails", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`trial2-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-2",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`split-insuf-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payments: [
          { method: "CASH", amountMinor: total / 2 - 100 },
          { method: "UPI", amountMinor: total / 2 }
        ],
        correlationId: "corr-2",
      });
      expect(res.status).toBe("validation_error");
    });

    it("Overpayment requires CASH", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`trial3-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-3",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`split-over-upi-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payments: [
          { method: "UPI", amountMinor: total + 100 }
        ],
        correlationId: "corr-3",
      });
      expect(res.status).toBe("validation_error");
    });

    it("Overpayment works with CASH", async () => {
      const trial = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`trial4-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payment: { method: "CASH" },
        correlationId: "trial-4",
      });
      if (trial.status !== "ok") throw new Error("trial failed");
      const total = trial.sale.totalMinor;

      const res = await createSale({
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        cashierUserId: IDS.ownerA,
        idempotencyKey: \`split-over-cash-\${Date.now()}\`,
        lines: [{ variantId: COMMERCE_IDS.tenantA.variants.variant1, quantity: 2 }],
        payments: [
          { method: "UPI", amountMinor: total - 100 },
          { method: "CASH", amountMinor: 200 }
        ],
        correlationId: "corr-4",
      });
      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.sale.totalMinor).toBe(total);
        expect(res.sale.paidMinor).toBe(total);
      }
    });
  });
});
`;
content = content.replace(/^}\);\s*$/m, newTests);
fs.writeFileSync("apps/web/src/test-integration/sales.test.ts", content);
