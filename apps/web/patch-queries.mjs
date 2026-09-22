import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/server/sales/saleQueries.ts');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /taxMinor: number;\n\s*lineDiscountMinor: number;\n\s*lineTotalMinor: number;\n\s*\}\[\];/,
  `taxMinor: number;\n    lineDiscountMinor: number;\n    lineTotalMinor: number;\n    imageUrl: string | null;\n  }[];`
);

c = c.replace(
  /lineDiscountMinor: true,\n\s*lineTotalMinor: true,\n\s*\},/,
  `lineDiscountMinor: true,\n          lineTotalMinor: true,\n          variant: { select: { product: { select: { imageUrl: true } } } },\n        },`
);

c = c.replace(
  /taxMinor: item\.taxMinor,\n\s*lineDiscountMinor: item\.lineDiscountMinor,\n\s*lineTotalMinor: item\.lineTotalMinor,\n\s*\}\)\),/,
  `taxMinor: item.taxMinor,\n      lineDiscountMinor: item.lineDiscountMinor,\n      lineTotalMinor: item.lineTotalMinor,\n      imageUrl: item.variant?.product?.imageUrl ?? null,\n    })),`
);

fs.writeFileSync(p, c);
console.log("Updated saleQueries.ts");
