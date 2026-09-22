import fs from 'fs';
import path from 'path';

let wsPath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx');
let wsContent = fs.readFileSync(wsPath, 'utf8');

// Fix Table Workspace Compression
wsContent = wsContent.replace(
  /<div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 mb-4 shrink-0 overflow-hidden">/,
  '<div className="flex flex-col lg:flex-row gap-5 mb-5 h-[480px] shrink-0">' // 480px easily gives 10 rows
);

// Fix KPI sizes
wsContent = wsContent.replace(/h-\[68px\]/g, 'h-[96px]');

// Fix Analytics row
wsContent = wsContent.replace(
  /<div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">/,
  '<div className="grid grid-cols-1 md:grid-cols-3 gap-5 pb-5">'
);

// Analytics cards need to have standard heights
wsContent = wsContent.replace(
  /<div className="bg-white p-4 flex flex-col shadow-subtle border border-slate-200 rounded-lg h-\[200px\] min-w-0">/g,
  '<div className="bg-white p-5 flex flex-col shadow-sm border border-slate-200 rounded-xl h-[280px] min-w-0">'
);
wsContent = wsContent.replace(
  /<div className="bg-white p-4 flex flex-col shadow-subtle border border-slate-200 rounded-lg h-\[200px\]">/g,
  '<div className="bg-white p-5 flex flex-col shadow-sm border border-slate-200 rounded-xl h-[280px] min-w-0">'
);
wsContent = wsContent.replace(
  /shadow-subtle rounded-lg/g,
  'shadow-sm rounded-xl'
);
wsContent = wsContent.replace(
  /shadow-subtle border/g,
  'shadow-sm border'
);


fs.writeFileSync(wsPath, wsContent);
console.log("Rewrote Workspace UI.");
