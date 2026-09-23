const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');

// 1. Add new icons to import
code = code.replace(/import \{ ([^}]+) \} from "lucide-react";/, 
  'import { $1, Baby, Gem, Footprints, Sparkles, Flame, Briefcase } from "lucide-react";');

// 2. Search & separate scan button
const searchRowRegex = /<div className="relative">[\s\S]*?<Search className="absolute left-3 top-1\/2 -translate-y-1\/2 w-4 h-4 text-slate-400" \/>[\s\S]*?<input[^>]*placeholder="Search products by name, SKU, barcode..."[^>]*\/>[\s\S]*?<button className="absolute right-3 top-1\/2 -translate-y-1\/2 text-slate-400 hover:text-slate-600">[\s\S]*?<Barcode className="w-4 h-4" \/>[\s\S]*?<\/button>[\s\S]*?<\/div>/;

const searchRowReplacement = `<div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products by name, SKU, barcode..."
                className="w-full pl-9 pr-4 py-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
              <Barcode className="w-4 h-4" />
              <span className="text-[13px] font-medium">Scan</span>
            </button>
          </div>`;

code = code.replace(searchRowRegex, searchRowReplacement);

// 3. Update filters to text-[13px]
code = code.replace(/text-xs/g, 'text-[12px]'); // Maybe replace text-xs in the filter row
code = code.replace(/text-sm/g, 'text-[13px]');

// 4. Categories row
const categoriesRegex = /<div className="px-4 py-3 flex gap-3 overflow-x-auto border-b border-slate-100 no-scrollbar">[\s\S]*?\{.+?\.map\(cat => \([\s\S]*?<div key=\{cat\}[\s\S]*?<Shirt className="w-5 h-5"\/>[\s\S]*?<\/div>[\s\S]*?<\/span>[\s\S]*?<\/div>[\s\S]*?\)\}[\s\S]*?<\/div>/;

const categoriesReplacement = `<div className="px-4 py-3 flex gap-3 overflow-x-auto border-b border-slate-100 no-scrollbar">
             {[
               { name: 'Men\\'s Wear', icon: Shirt },
               { name: 'Women\\'s Wear', icon: Sparkles },
               { name: 'Kids Wear', icon: Baby },
               { name: 'Ethnic Wear', icon: Flame },
               { name: 'Footwear', icon: Footprints },
               { name: 'Accessories', icon: Briefcase },
               { name: 'Innerwear', icon: Tag },
               { name: 'New Arrivals', icon: Zap },
               { name: 'Offers', icon: Gem },
             ].map(cat => (
               <div key={cat.name} className="flex flex-col items-center gap-1.5 min-w-[72px] cursor-pointer group">
                  <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:border-blue-200 group-hover:bg-blue-50">
                    <cat.icon className="w-5 h-5"/>
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 text-center">{cat.name}</span>
               </div>
             ))}
          </div>`;

code = code.replace(categoriesRegex, categoriesReplacement);

// 5. Product Grid sizing
code = code.replace(/text-lg font-bold/g, 'text-[15px] font-bold');
code = code.replace(/text-2xl font-bold/g, 'text-[20px] font-bold');

// 6. Right checkout width
code = code.replace(/lg:w-\[400px\] xl:w-\[440px\]/g, 'w-[390px] shrink-0');

fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', code);
console.log('Patched');
