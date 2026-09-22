import fs from 'fs';
import path from 'path';

let pagePath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/page.tsx');
let pageContent = fs.readFileSync(pagePath, 'utf8');

pageContent = pageContent.replace(
  /<LinkButton href="\/sales\/export" variant="outline" className="h-8 px-3 text-\[12px\] bg-white text-slate-600 shadow-subtle border-slate-200">/g,
  '<a href="/sales/export" className="inline-flex items-center justify-center rounded h-8 px-3 text-[12px] font-medium bg-white text-slate-600 shadow-sm border border-slate-200 hover:bg-slate-50">'
);
pageContent = pageContent.replace(/<\/LinkButton>/g, '</a>');

fs.writeFileSync(pagePath, pageContent);

let wsPath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx');
let wsContent = fs.readFileSync(wsPath, 'utf8');

// Fix itemCount -> itemsCount
wsContent = wsContent.replace(/row\.itemCount/g, 'row.itemsCount');
wsContent = wsContent.replace(/activeTxRow\.itemCount/g, 'activeTxRow.itemsCount');

// Fix null customer name
wsContent = wsContent.replace(/activeTxRow\.customerName === "Walk-in Customer"/g, '(activeTxRow.customerName || "Walk-in Customer") === "Walk-in Customer"');
wsContent = wsContent.replace(/activeTxRow\.customerName\.charAt\(0\)/g, '(activeTxRow.customerName || "W").charAt(0)');
wsContent = wsContent.replace(/txDetail\?\.customer\?\.name \|\| activeTxRow\.customerName/g, 'txDetail?.customer?.name || activeTxRow.customerName || "Walk-in Customer"');
wsContent = wsContent.replace(/row\.customerName\}/g, 'row.customerName || "Walk-in Customer"}');
wsContent = wsContent.replace(/row\.paymentMethod\}/g, 'row.paymentMethod || "Unknown"}');

// Fix paymentMethod on activeTxRow
wsContent = wsContent.replace(/activeTxRow\.paymentMethod\.charAt\(0\)/g, '(activeTxRow.paymentMethod || "U").charAt(0)');
wsContent = wsContent.replace(/>\{activeTxRow\.paymentMethod\}<\/p>/g, '>{activeTxRow.paymentMethod || "Unknown"}</p>');

fs.writeFileSync(wsPath, wsContent);
console.log("Fixed TS errors");
