import fs from 'fs';

let f = 'src/app/(app)/dashboard/page.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/import { redirect } from "next\/navigation";/, `import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, ChevronDown, Monitor, Plus, ArrowDownToLine, FileText } from "lucide-react";`);

const oldHeader = `<div className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-sky-700">
            <span className="size-1.5 rounded-full bg-sky-500" /> Store cockpit <span className="text-slate-300">/</span> {context.storeName}
          </div>
          <h1 className="text-[25px] font-bold tracking-[-0.04em] text-slate-900 md:text-[28px]">
            {greetingFor()}, {context.userName} <span className="text-sky-600">.</span>
          </h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Here&apos;s what&apos;s moving across your operation today &middot; {formatTradingDay(startOfStoreDay())}
          </p>
        </div>
      </div>`;

const newHeader = `<div className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-slate-900">
            Good Evening, {context.userName.split(' ')[0]} 👋
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Here&apos;s what&apos;s happening at {context.storeName} today
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 border-r border-slate-200 pr-4">
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-slate-50">
              <Calendar size={14} className="text-sky-600" />
              Today (Live)
              <ChevronDown size={14} className="text-slate-400 ml-1" />
            </div>
            <span className="text-[13px] text-slate-500 font-medium">
              {formatTradingDay(startOfStoreDay())}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <Link href="/pos" className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-[13px] font-semibold text-sky-700 hover:bg-sky-100">
              <Monitor size={14} /> POS (F2)
            </Link>
            <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
              <Plus size={14} className="text-sky-600" /> Add Item
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
              <ArrowDownToLine size={14} className="text-sky-600" /> Receive Stock
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
              <FileText size={14} className="text-sky-600" /> Generate Report
            </button>
          </div>
        </div>
      </div>`;

c = c.replace(oldHeader, newHeader);

c = c.replace(/<div className="mx-auto w-full max-w-\[1540px\] p-4 md:p-6">/, '<div className="w-full px-5 py-4">');

fs.writeFileSync(f, c);
