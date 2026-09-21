import fs from 'fs';
let f = 'src/components/dashboard/SalesTrendCard.tsx';
let c = fs.readFileSync(f, 'utf8');

const oldHover = `{hoverIndex !== null && (
        <div 
          className="absolute z-20 bg-slate-800 text-white text-[10px] p-2.5 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all"
          style={{ 
            left: \`calc(2rem + \${(hoverIndex / count) * (100 - (48/630*100))}%) \`,
            top: 'calc(100% - 40px)',
          }}
        >
          <div className="font-bold mb-1.5 text-slate-200 border-b border-slate-600 pb-1">{filteredData[hoverIndex].label}</div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-sky-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Sales:</span> 
            <span className="font-semibold font-mono">{formatMinor(filteredData[hoverIndex].salesMinor)}</span>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap mt-1">
            <span className="size-2 rounded-full bg-violet-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Bills:</span> 
            <span className="font-semibold font-mono">{filteredData[hoverIndex].billCount}</span>
          </div>
        </div>
      )}`;

const newHover = `{hoverIndex !== null && filteredData[hoverIndex] && (
        <div 
          className="absolute z-20 bg-slate-800 text-white text-[10px] p-2.5 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all"
          style={{ 
            left: \`calc(2rem + \${(hoverIndex / count) * (100 - (48/630*100))}%) \`,
            top: 'calc(100% - 40px)',
          }}
        >
          <div className="font-bold mb-1.5 text-slate-200 border-b border-slate-600 pb-1">{filteredData[hoverIndex]!.label}</div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-sky-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Sales:</span> 
            <span className="font-semibold font-mono">{formatMinor(filteredData[hoverIndex]!.salesMinor)}</span>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap mt-1">
            <span className="size-2 rounded-full bg-violet-400 shrink-0"></span>
            <span className="text-slate-300 w-8">Bills:</span> 
            <span className="font-semibold font-mono">{filteredData[hoverIndex]!.billCount}</span>
          </div>
        </div>
      )}`;

c = c.replace(oldHover, newHover);
fs.writeFileSync(f, c);
