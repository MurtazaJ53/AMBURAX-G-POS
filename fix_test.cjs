const fs = require('fs');
let code = fs.readFileSync('apps/web/src/test-integration/sales.test.ts', 'utf8');

code = code.replace(
  /const \{ getSalesList, getSalesAnalytics \} = await import\('@\/server\/sales\/saleQueries'\);[\s\S]*?const analytics = await getSalesAnalytics\(IDS\.tenantA, IDS\.ownerA, \{\}\);\n    expect\(analytics\.paymentMix\.length\)\.toBeGreaterThan\(0\);\n  \}\);\n\}\);/m,
  `const { listSalesPage, getSalesAnalytics } = await import('@/server/sales/saleQueries');
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
    const list = await listSalesPage({ tenantId: IDS.tenantA });
    const row = list.rows.find((r: any) => r.id === (res as any).sale?.id);
    expect(row).toBeDefined();
    expect(row?.paymentMethod).toContain('CASH');
    expect(row?.paymentMethod).toContain('UPI');
    expect(row?.paymentMethod).toContain('+');
    const analytics = await getSalesAnalytics({ tenantId: IDS.tenantA });
    expect(analytics.paymentMix.length).toBeGreaterThan(0);
  });
});`
);

fs.writeFileSync('apps/web/src/test-integration/sales.test.ts', code);
