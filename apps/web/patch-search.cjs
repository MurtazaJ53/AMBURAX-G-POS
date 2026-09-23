const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');

const regex = /<div className="relative">[\s\S]*?<Search className="absolute left-3 top-1\/2 -translate-y-1\/2 w-4 h-4 text-slate-400" \/>[\s\S]*?<input[\s\S]*?className="w-full pl-9 pr-10 py-2\.5 text-\[13px\] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500\/20 focus:border-blue-500"[\s\S]*?\/>[\s\S]*?<button className="absolute right-3 top-1\/2 -translate-y-1\/2 text-slate-400 hover:text-slate-600">[\s\S]*?<Barcode className="w-4 h-4" \/>[\s\S]*?<\/button>[\s\S]*?<\/div>/;

const replacement = `<div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products by name, SKU, barcode..."
                className="w-full pl-9 py-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
              <Barcode className="w-4 h-4" />
              <span className="text-[13px] font-medium">Scan</span>
            </button>
          </div>`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', code);
    console.log("Success");
} else {
    console.log("Not found");
}
