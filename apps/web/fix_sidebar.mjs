import fs from 'fs';
let f = 'src/components/shell/AppSidebar.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/import { Store, X, Zap } from "lucide-react";/, 'import { Store, X, Cloud } from "lucide-react";');
c = c.replace(/w-\[244px\]/g, 'w-[238px]');

const oldBottom = `<div className="relative border-t border-slate-200 p-4">
        <div className="rounded-lg bg-sky-50/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-slate-700">
            <Zap size={13} className="text-amber-500" /> Connect capabilities
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">Add Procurement or CRM when your operation is ready.</p>
          <button type="button" className="mt-3 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-50">
            Explore capabilities
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[9px] text-slate-500">
          <span className="size-1.5 rounded-full bg-emerald-500" /> All systems operational
        </div>
      </div>`;

const newBottom = `<div className="relative border-t border-slate-100 p-4 pb-3">
        <div className="rounded-lg bg-sky-50/50 p-3 pb-0 relative overflow-hidden">
          <div className="relative z-10">
            <div className="mb-1 text-[11px] font-bold text-sky-800">
              Grow Your Business
            </div>
            <p className="text-[10px] leading-snug text-slate-500">New season collection setup<br/>in 2 steps</p>
            <Link href="/products" className="mt-2.5 mb-3 inline-block rounded border border-sky-600 bg-sky-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-sky-700">
              Add Products
            </Link>
          </div>
          <div className="absolute right-[-10px] bottom-0 opacity-80 h-[50px] w-[60px] bg-sky-100 rounded"></div>
        </div>
        <div className="mt-3.5 flex items-center justify-between text-[11px] text-slate-600 font-medium">
          <span className="flex items-center gap-1.5"><Cloud size={14} className="text-slate-400" /> Cloud Sync</span>
          <span className="text-[9px] text-slate-400 font-normal">Just now</span>
        </div>
      </div>`;

c = c.replace(oldBottom, newBottom);

fs.writeFileSync(f, c);

let shellF = 'src/components/shell/AppShell.tsx';
let shellC = fs.readFileSync(shellF, 'utf8');
shellC = shellC.replace(/lg:pl-\[244px\]/g, 'lg:pl-[238px]');
fs.writeFileSync(shellF, shellC);
