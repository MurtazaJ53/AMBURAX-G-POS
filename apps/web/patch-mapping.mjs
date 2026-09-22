import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/server/sales/saleQueries.ts');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /taxMinor: i\.taxMinor,\n\s*lineDiscountMinor: i\.lineDiscountMinor,\n\s*lineTotalMinor: i\.lineTotalMinor,\n\s*\}\)\),/,
  `taxMinor: i.taxMinor,\n      lineDiscountMinor: i.lineDiscountMinor,\n      lineTotalMinor: i.lineTotalMinor,\n      imageUrl: i.variant?.product?.imageUrl ?? null,\n    })),`
);

fs.writeFileSync(p, c);
console.log("Updated saleQueries.ts");
