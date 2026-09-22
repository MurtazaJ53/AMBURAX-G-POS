import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx');
let c = fs.readFileSync(p, 'utf8');

const itemsBlock = `{txDetail ? (
                    txDetail.items.map(item => (
                      <div key={item.id} className="flex gap-2.5 items-start">
                        {item.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={item.imageUrl} alt={item.name} className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0 bg-white" />
                        ) : (
                          <div className="w-9 h-9 rounded bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center text-slate-300">
                            <Package size={16} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-start gap-2 mb-0.5">
                            <p className="text-[12px] font-medium text-slate-800 leading-snug truncate">{item.name}</p>
                            <span className="text-[12px] font-bold text-slate-900 shrink-0">{formatMinor(item.lineTotalMinor)}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-medium">{formatMinor(item.unitPriceMinor)} × {item.quantity}</p>
                        </div>
                      </div>
                    ))
                  ) : (`;

c = c.replace(
  /\{txDetail \? \(\n\s*txDetail\.items\.map\(item => \(\n\s*<div key=\{item\.id\} className="flex gap-2\.5 items-start">\n\s*<div className="w-9 h-9 rounded bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center text-slate-300">\n\s*<Package size=\{16\} \/>\n\s*<\/div>\n\s*<div className="min-w-0 flex-1">\n\s*<div className="flex justify-between items-start gap-2 mb-0\.5">\n\s*<p className="text-\[12px\] font-medium text-slate-800 leading-snug truncate">\{item\.name\}<\/p>\n\s*<span className="text-\[12px\] font-bold text-slate-900 shrink-0">\{formatMinor\(item\.lineTotalMinor\)\}<\/span>\n\s*<\/div>\n\s*<p className="text-\[11px\] text-slate-500 font-medium">\{formatMinor\(item\.unitPriceMinor\)\} [×x] \{item\.quantity\}<\/p>\n\s*<\/div>\n\s*<\/div>\n\s*\)\)\n\s*\) : \(/,
  itemsBlock
);

fs.writeFileSync(p, c);
console.log("Updated SalesWorkspace.tsx");
