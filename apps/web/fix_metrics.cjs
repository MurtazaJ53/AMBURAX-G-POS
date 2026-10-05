const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(
  /<span className="block text-\[10px\] uppercase tracking-wider text-slate-500 mb-0\.5">Lifetime Spend<\/span>[\s\S]*?<b className="text-\[13px\] text-slate-900">{formatMinor\(detail\.totalSpentMinor\)}<\/b>/m,
  `<span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Total Due</span>\n              <b className="text-[13px] text-slate-900" title="ERP receivables not connected">--</b>`
);

content = content.replace(/\?""/g, '—');

fs.writeFileSync(file, content);
