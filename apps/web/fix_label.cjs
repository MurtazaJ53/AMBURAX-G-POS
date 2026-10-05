const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(
  /<span className="block text-\[10px\] uppercase tracking-wider text-slate-500 mb-0\.5">Avg Order Val<\/span>/g,
  '<span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Avg Order Value</span>'
);

fs.writeFileSync(file, content);
