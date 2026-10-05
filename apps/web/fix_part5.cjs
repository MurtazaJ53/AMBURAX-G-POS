const fs = require("fs");
const file = "src/app/(app)/customers/page.tsx";
let content = fs.readFileSync(file, "utf8");

// 1. Replace Recent Payments View All
content = content.replace(
  /<div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50\/50">\s*<h2 className="text-\[13px\] font-bold text-slate-900">Recent Payments<\/h2>\s*<Link href="#" className="text-\[11px\] font-semibold text-blue-600 hover:text-blue-800">View All<\/Link>\s*<\/div>/,
  `<div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50/50">
            <h2 className="text-[13px] font-bold text-slate-900">Recent Payments</h2>
            <button type="button" disabled title="Requires ERP Connection" className="text-[11px] font-semibold text-blue-600 opacity-60 cursor-not-allowed">
              View All <span className="sr-only">(Unavailable: Requires ERP Connection)</span>
            </button>
          </div>`
);

// 2. Replace Top Due Customers View All
content = content.replace(
  /<div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50\/50">\s*<h2 className="text-\[13px\] font-bold text-slate-900">Top Due Customers<\/h2>\s*<Link href="#" className="text-\[11px\] font-semibold text-blue-600 hover:text-blue-800">View All<\/Link>\s*<\/div>/,
  `<div className="border-b border-slate-100 p-3 flex justify-between items-center bg-slate-50/50">
            <h2 className="text-[13px] font-bold text-slate-900">Top Due Customers</h2>
            <button type="button" disabled title="Requires ERP Connection" className="text-[11px] font-semibold text-blue-600 opacity-60 cursor-not-allowed">
              View All <span className="sr-only">(Unavailable: Requires ERP Connection)</span>
            </button>
          </div>`
);

// 3. Replace Send Reminders button
content = content.replace(
  /<button className="bg-blue-600 text-white hover:bg-blue-700 text-\[11px\] font-semibold py-1.5 px-4 rounded-md shadow-sm transition-colors mt-auto self-start">\s*Send Reminders\s*<\/button>/,
  `<button type="button" disabled title="Requires ERP Connection" className="bg-blue-600 text-white text-[11px] font-semibold py-1.5 px-4 rounded-md shadow-sm opacity-60 cursor-not-allowed mt-auto self-start">
                Send Reminders <span className="sr-only">(Unavailable: Requires ERP Connection)</span>
              </button>`
);

fs.writeFileSync(file, content);
console.log("Success");
