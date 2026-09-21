import fs from 'fs';
let f = 'src/components/dashboard/OperationsCards.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(
  /<table className="dashboard-table w-full min-w-\[390px\]">/,
  '<table className="dashboard-table w-full min-w-[390px] xl:min-w-0">'
);
c = c.replace(
  /<th>#<\/th>\s*<th>Product<\/th>\s*<th>SKU<\/th>\s*<th>Sold<\/th>\s*<th className="text-right">Revenue<\/th>/,
  '<th className="w-8">#</th><th className="w-full">Product</th><th className="whitespace-nowrap">SKU</th><th className="whitespace-nowrap">Sold</th><th className="whitespace-nowrap text-right">Revenue</th>'
);
c = c.replace(
  /<td>\s*<div className="flex items-center gap-2">\s*<ProductThumb name=\{product\.name\} imageUrl=\{product\.imageUrl\} \/>\s*<span className="max-w-\[125px\] truncate font-semibold text-slate-700" title=\{product\.name\}>\s*\{product\.name\}\s*<\/span>\s*<\/div>\s*<\/td>/g,
  '<td className="w-full max-w-[0px]"><div className="flex items-center gap-2"><ProductThumb name={product.name} imageUrl={product.imageUrl} /><span className="truncate font-semibold text-slate-700" title={product.name}>{product.name}</span></div></td>'
);

c = c.replace(
  /<table className="dashboard-table w-full min-w-\[350px\]">/,
  '<table className="dashboard-table w-full min-w-[350px] xl:min-w-0">'
);
c = c.replace(
  /<th>Product<\/th>\s*<th>SKU<\/th>\s*<th>Stock<\/th>\s*<th>Reorder<\/th>/,
  '<th className="w-full">Product</th><th className="whitespace-nowrap">SKU</th><th className="whitespace-nowrap">Stock</th><th className="whitespace-nowrap">Reorder</th>'
);
c = c.replace(
  /<td>\s*<div className="flex items-center gap-2">\s*<ProductThumb name=\{row\.productName\} imageUrl=\{row\.imageUrl\} \/>\s*<span className="max-w-\[118px\] truncate font-semibold text-slate-700" title=\{row\.productName\}>\s*\{row\.productName\}\s*<\/span>\s*<\/div>\s*<\/td>/g,
  '<td className="w-full max-w-[0px]"><div className="flex items-center gap-2"><ProductThumb name={row.productName} imageUrl={row.imageUrl} /><span className="truncate font-semibold text-slate-700" title={row.productName}>{row.productName}</span></div></td>'
);

c = c.replace(
  /<table className="dashboard-table w-full min-w-\[420px\]">/,
  '<table className="dashboard-table w-full min-w-[420px] xl:min-w-0">'
);
c = c.replace(
  /<th>Time<\/th>\s*<th>Bill no\.<\/th>\s*<th>Customer<\/th>\s*<th>Amount<\/th>\s*<th>Status<\/th>/,
  '<th className="whitespace-nowrap">Time</th><th className="whitespace-nowrap">Bill no.</th><th className="w-full">Customer</th><th className="whitespace-nowrap">Amount</th><th className="whitespace-nowrap">Status</th>'
);
c = c.replace(
  /<td className="max-w-\[78px\] truncate text-slate-600">\{sale\.customerName \?\? 'Walk-in'\}<\/td>/g,
  '<td className="w-full max-w-[0px] truncate text-slate-600" title={sale.customerName ?? "Walk-in"}>{sale.customerName ?? "Walk-in"}</td>'
);

// We must also use min-w-0 on the grid cells in page.tsx if they aren't already.
// Wait, the grid cells in page.tsx don't have min-w-0. Let's fix that too.
let pageF = 'src/app/(app)/dashboard/page.tsx';
let pageC = fs.readFileSync(pageF, 'utf8');
pageC = pageC.replace(
  /<section className="mt-4 grid gap-4 lg:grid-cols-3 xl:grid-cols-3">/g,
  '<section className="mt-4 grid gap-4 lg:grid-cols-3 xl:grid-cols-3 xl:min-w-0 *:[min-width:0]">'
);
// Wait, *:[min-width:0] is valid tailwind, but simpler: add min-w-0 to each grid child wrapper if it has one.
// The grid directly contains FastMovingProductsCard, StockSignalCard, RecentSalesCard. So giving min-w-0 to the children.
// The grid is just:
// <section className="mt-4 grid gap-4 xl:grid-cols-3">
//   <FastMovingProductsCard />
//   <StockSignalCard />
//   <RecentSalesCard />
// </section>
// We can just add min-w-0 to the top level div of those components.
// I'll add min-w-0 to `surface-card` inside OperationsCards.tsx.

c = c.replace(
  /<div className="surface-card overflow-hidden rounded-lg flex flex-col h-full">/g,
  '<div className="surface-card overflow-hidden rounded-lg flex flex-col h-full min-w-0">'
);

fs.writeFileSync(f, c);
fs.writeFileSync(pageF, pageC);
