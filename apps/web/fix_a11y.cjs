const fs = require("fs");
const file = "src/app/(app)/customers/page.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(
  /<div className="text-\[12px\] font-semibold text-slate-900 truncate leading-tight">([^<]+)<\/div>/g,
  '<div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">$1 <span className="sr-only">(Unavailable: Requires ERP Connection)</span></div>'
);

fs.writeFileSync(file, content);
