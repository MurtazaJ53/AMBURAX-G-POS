const fs = require('fs');
let content = fs.readFileSync('src/test-integration/returnQueries.test.ts', 'utf8');

content = content.replace(/await db.user.upsert\(\{ where: \{ id: "u1" \}.*?\);/g, 
  `await db.user.upsert({ where: { id: "u1" }, update: {}, create: { id: "u1", tenantId, email: "u1@t.com", name: "u1", passwordHash: "h", tenantRole: "STAFF" } });
    await db.product.upsert({ where: { id: "p1" }, update: {}, create: { id: "p1", tenantId, name: "P1" } });
    await db.productVariant.upsert({ where: { id: "var_1" }, update: {}, create: { id: "var_1", tenantId, productId: "p1", sku: "SKU-Q-1", priceMinor: 100 } });
    await db.productVariant.upsert({ where: { id: "var_2" }, update: {}, create: { id: "var_2", tenantId, productId: "p1", sku: "SKU-Q-2", priceMinor: 100 } });`);

fs.writeFileSync('src/test-integration/returnQueries.test.ts', content);
