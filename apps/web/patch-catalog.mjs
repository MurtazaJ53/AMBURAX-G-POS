import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/server/sales/catalog.ts');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /export interface CatalogHit \{\n\s*variantId: string;\n\s*productName: string;/,
  `export interface CatalogHit {\n  variantId: string;\n  productName: string;\n  imageUrl: string | null;`
);

c = c.replace(
  /product: \{ select: \{ name: true \} \},/g,
  `product: { select: { name: true, imageUrl: true } },`
);

c = c.replace(
  /productName: v\.product\.name,\n\s*sku: v\.sku,/g,
  `productName: v.product.name,\n    imageUrl: v.product.imageUrl,\n    sku: v.sku,`
);

c = c.replace(
  /productName: variant\.product\.name,\n\s*sku: variant\.sku,/g,
  `productName: variant.product.name,\n    imageUrl: variant.product.imageUrl,\n    sku: variant.sku,`
);

fs.writeFileSync(p, c);
console.log("Updated catalog.ts with imageUrl");
