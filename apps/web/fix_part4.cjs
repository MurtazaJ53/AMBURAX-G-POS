const fs = require("fs");
const file = "src/app/(app)/customers/page.tsx";
let content = fs.readFileSync(file, "utf8");

const replacement = `<div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4 mb-5">
        {/* Customer Due Overview (Pie Chart replacement) */}
        <Card className="flex flex-col col-span-1 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[212px]">
          <div className="border-b border-slate-100 py-2.5 px-3">
            <h2 className="text-[13px] font-bold text-slate-900">Customer Due Overview</h2>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <PieChart className="h-8 w-8 text-slate-200 mb-2" />
            <p className="text-[13px] font-medium text-slate-900">No Overview Data</p>
            <p className="text-[11px] text-slate-500 text-center mt-1">Connect ERP receivables to view due segments.</p>
          </div>
        </Card>
        
        {/* Due Amount Trend (Line Chart replacement) */}
        <Card className="flex flex-col col-span-1 xl:col-span-2 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[212px]">
          <div className="border-b border-slate-100 p-3 flex justify-between items-center">
            <h2 className="text-[13px] font-bold text-slate-900">Due Amount Trend</h2>
            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Last 6 Months</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <TrendingUp className="h-8 w-8 text-slate-200 mb-2" />
            <p className="text-[13px] font-medium text-slate-900">No Trend Data</p>
            <p className="text-[11px] text-slate-500 text-center mt-1">Authoritative trend data is managed in ERPNext.</p>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="flex flex-col col-span-1 md:col-span-2 xl:col-span-1 border border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white h-[212px]">
          <div className="border-b border-slate-100 py-2.5 px-3">
            <h2 className="text-[13px] font-bold text-slate-900">Quick Actions</h2>
          </div>
          <div className="flex-1 p-2 flex flex-col justify-between">
            <button
              type="button"
              disabled
              title="Requires ERP Connection"
              className="flex items-center gap-3 p-1 rounded transition-colors text-left group opacity-60 cursor-not-allowed w-full"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">View All Dues</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">See complete pending dues</div>
              </div>
            </button>
            <button
              type="button"
              disabled
              title="Requires ERP Connection"
              className="flex items-center gap-3 p-1 rounded transition-colors text-left group opacity-60 cursor-not-allowed w-full"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Send Due Reminder</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">WhatsApp / SMS / Call</div>
              </div>
            </button>
            <button
              type="button"
              disabled
              title="Requires ERP Connection"
              className="flex items-center gap-3 p-1 rounded transition-colors text-left group opacity-60 cursor-not-allowed w-full"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Create Khata</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">Open new khata for customer</div>
              </div>
            </button>
            <button
              type="button"
              disabled
              title="Requires ERP Connection"
              className="flex items-center gap-3 p-1 rounded transition-colors text-left group opacity-60 cursor-not-allowed w-full"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <CreditCard className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-900 truncate leading-tight">Collect Payment</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">Record customer payment</div>
              </div>
            </button>
          </div>
        </Card>
      </div>`;

// Find where to inject
const startIndex = content.indexOf('<div className="grid gap-4 grid-cols-1 lg:grid-cols-4 mb-5">');
const endIndexStr = `<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">`;
const endIndex = content.indexOf(endIndexStr);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + replacement + '\n\n      ' + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log("Success");
} else {
  console.log("Could not find start or end index");
}
