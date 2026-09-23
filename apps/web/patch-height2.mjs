import fs from 'fs';

let p = 'src/app/(app)/pos/PosTerminal.tsx';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/className="flex flex-1 h-full min-h-0 overflow-hidden bg-slate-50 flex-col lg:flex-row"/g, 'className="flex w-full h-[calc(100vh-68px)] overflow-hidden bg-slate-50 flex-col lg:flex-row"');

c = c.replace(/<div className="w-full lg:w-\[400px\] xl:w-\[440px\] flex flex-col bg-slate-50\/50 lg:border-l border-slate-200 flex-shrink-0 h-\[50vh\] lg:h-auto overflow-hidden">/g, '<div className="w-full lg:w-[400px] xl:w-[440px] flex flex-col bg-slate-50/50 lg:border-l border-slate-200 flex-shrink-0 h-[50vh] lg:h-full overflow-hidden">');

fs.writeFileSync(p, c);
console.log("Fixed height");
