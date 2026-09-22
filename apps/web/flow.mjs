import fs from 'fs';
import path from 'path';

let pagePath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/page.tsx');
let pageContent = fs.readFileSync(pagePath, 'utf8');

pageContent = pageContent.replace(
  /<div className="flex w-full flex-col p-4 sm:p-5" style=\{\{ height: "calc\(100vh - 68px\)" \}\}>/,
  '<div className="flex w-full flex-col p-5 max-w-[1600px] mx-auto">'
);

pageContent = pageContent.replace(
  /<h1 className="text-\[24px\] font-bold text-slate-900 leading-tight">Sales & Transaction History<\/h1>/,
  '<h1 className="text-[25px] font-bold text-slate-900 leading-tight tracking-tight">Sales & Transaction History</h1>'
);
pageContent = pageContent.replace(
  /<p className="text-\[14px\] text-slate-500 mt-0\.5">View, search and manage all your sales, returns and transactions<\/p>/,
  '<p className="text-[14.5px] text-slate-500 mt-0.5">View, search and manage all your sales, returns and transactions</p>'
);
pageContent = pageContent.replace(
  /<div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between shrink-0">/,
  '<div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between shrink-0">'
);

fs.writeFileSync(pagePath, pageContent);

let wsPath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx');
let wsContent = fs.readFileSync(wsPath, 'utf8');

wsContent = wsContent.replace(
  /<div className="flex flex-col lg:flex-row gap-5 mb-5 h-\[480px\] shrink-0">/,
  '<div className="flex flex-col lg:flex-row gap-5 mb-5 h-[480px] shrink-0">' // Actually it's already 480px? Wait, previously it was flex-1 min-h-0.
);

fs.writeFileSync(wsPath, wsContent);
console.log("Rewrote page and workspace");
