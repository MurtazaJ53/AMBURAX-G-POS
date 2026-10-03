const fs = require('fs');
const file = 'apps/web/src/server/sales/saleQueries.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Remove take: 1
code = code.replace(
  'payments: { select: { status: true, method: true }, take: 1 },',
  'payments: { select: { status: true, method: true } },'
);

// 2. Fix toListRow
code = code.replace(
  'paymentStatus: s.payments[0]?.status ?? null,\n    paymentMethod: s.payments[0]?.method ?? null,',
  `paymentStatus: s.payments[0]?.status ?? null,\n    paymentMethod: s.payments.length > 1 \n      ? Array.from(new Set(s.payments.map(p => p.method))).join(" + ")\n      : (s.payments[0]?.method ?? null),`
);

// 3. Fix analytics timezone (IST)
code = code.replace(
  /const now = new Date\(\);[\s\S]*?const daily = new Map<string, number>\(\);/m,
  `const now = new Date();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  function getISTDate(d: Date) { return new Date(d.getTime() + IST_OFFSET_MS); }
  
  const nowIST = getISTDate(now);
  const trendStartDate = params.from || new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate() - 6) - IST_OFFSET_MS);
  const trendEndDate = params.to || new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate() + 1) - IST_OFFSET_MS);

  const sales = await db.sale.findMany({
    where: { 
      ...where, 
      status: "COMPLETED",
      completedAt: { gte: trendStartDate, lt: trendEndDate }
    },
    select: { completedAt: true, totalMinor: true },
    orderBy: { completedAt: "asc" },
  });

  const daily = new Map<string, number>();`
);

code = code.replace(
  /let current = new Date\(trendStartDate\);[\s\S]*?current\.setUTCDate\(current\.getUTCDate\(\) \+ 1\);\n  }/m,
  `let current = new Date(trendStartDate);
  while (current < trendEndDate) {
    const curIST = getISTDate(current);
    const key = \`\${curIST.getUTCFullYear()}-\${String(curIST.getUTCMonth() + 1).padStart(2, "0")}-\${String(curIST.getUTCDate()).padStart(2, "0")}\`;
    daily.set(key, 0);
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }`
);

code = code.replace(
  /for \(const s of sales\) \{[\s\S]*?if \(daily\.has\(key\)\) \{\n      daily\.set\(key, daily\.get\(key\)! \+ s\.totalMinor\);\n    \}\n  }/m,
  `for (const s of sales) {
    const dIST = getISTDate(s.completedAt);
    const key = \`\${dIST.getUTCFullYear()}-\${String(dIST.getUTCMonth() + 1).padStart(2, "0")}-\${String(dIST.getUTCDate()).padStart(2, "0")}\`;
    if (daily.has(key)) {
      daily.set(key, daily.get(key)! + s.totalMinor);
    }
  }`
);

fs.writeFileSync(file, code);
