const fs = require("fs");
const file = "src/app/(app)/customers/page.tsx";
let content = fs.readFileSync(file, "utf8");

// Fix analytics card heights and paddings
content = content.replace(/h-\[200px\]/g, 'h-[212px]');
content = content.replace(/<div className="border-b border-slate-100 p-3">/g, '<div className="border-b border-slate-100 py-2.5 px-3">');

// Shrink quick action button paddings
content = content.replace(/p-1\.5 rounded hover:bg-slate-50/g, 'p-1 rounded hover:bg-slate-50');

fs.writeFileSync(file, content);
