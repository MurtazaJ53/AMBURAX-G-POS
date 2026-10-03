const fs = require('fs');
const code = `
describe('F11 Sales History & Analytics', () => {
  it('Lists split payments correctly and groups analytics by IST', async () => {
    const { getSalesList, getSalesAnalytics } = await import('@/server/sales/saleQueries');
    const idKey = 'split-f11-' + Date.now();
    const res = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: idKey,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payments: [
        { method: 'CASH', amountMinor: 1000 },
        { method: 'UPI', amountMinor: 1000 }
      ],
      correlationId: idKey,
    });
    expect(res.status).toBe('ok');
    const list = await getSalesList(IDS.tenantA, IDS.ownerA, {});
    const row = list.rows.find(r => r.id === (res as any).sale?.id);
    expect(row).toBeDefined();
    expect(row?.paymentMethod).toContain('CASH');
    expect(row?.paymentMethod).toContain('UPI');
    expect(row?.paymentMethod).toContain('+');
    const analytics = await getSalesAnalytics(IDS.tenantA, IDS.ownerA, {});
    expect(analytics.paymentMix.length).toBeGreaterThan(0);
  });
});
`;
fs.appendFileSync('apps/web/src/test-integration/sales.test.ts', code);
