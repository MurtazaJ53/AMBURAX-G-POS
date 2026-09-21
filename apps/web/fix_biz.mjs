import fs from 'fs';
let f = 'src/components/dashboard/BusinessCards.tsx';
let c = fs.readFileSync(f, 'utf8');

const newSeasonHtml = `export function NextStepBanner({ uncountedVariants }: { uncountedVariants: number }) {
  return (
    <div className="surface-card flex min-h-[92px] items-center gap-4 overflow-hidden rounded-lg bg-sky-50/30 p-4 h-full relative">
      <div className="min-w-0 flex-1 z-10">
        <h2 className="mt-1 text-[14px] font-bold text-slate-800">Grow Your Business</h2>
        <p className="mt-1 text-[10px] text-slate-500">New season collection setup<br/>in 2 steps.</p>
        <Link href="/products" className="mt-3 inline-block shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-700">
          Add Products
        </Link>
      </div>
      <div className="absolute right-0 bottom-0 opacity-50 sm:opacity-100 pr-2 pb-2">
        {/* Placeholder for bags/clothing image */}
        <div className="w-[100px] h-[80px] bg-sky-100 rounded opacity-50"></div>
      </div>
    </div>
  );
}`;

c = c.replace(/export function NextStepBanner([\s\S]*?)Link>\s+<\/div>\s+\);\s+}/, newSeasonHtml);


const shiftHtml = `export function ShiftStatusCard({ activity }: { activity: DashboardShiftActivity }) {
  return (
    <div className="surface-card rounded-lg p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-slate-800">Store Staff <span className="text-slate-400 font-normal">(Shift Live) &darr;</span></h2>
      </div>
      <div className="mt-1">
        <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
          <span className="size-1.5 bg-emerald-500 rounded-full"></span> {activity.cashiers.length} Active / 0 Break
        </span>
      </div>
      <div className="mt-auto flex items-end gap-1.5">
        {activity.cashiers.slice(0, 5).map((c, i) => (
          <div key={i} className="size-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600">
            {c.name.substring(0, 2).toUpperCase()}
          </div>
        ))}
        {activity.cashiers.length > 5 && (
          <div className="size-7 rounded-full bg-slate-50 flex items-center justify-center text-[9px] font-bold text-slate-400">
            +{activity.cashiers.length - 5}
          </div>
        )}
        {activity.cashiers.length === 0 && (
          <div className="text-[11px] text-slate-400">No active staff</div>
        )}
      </div>
    </div>
  );
}`;
c = c.replace(/export function ShiftStatusCard([\s\S]*?)<\/div>\s+\);\s+}/, shiftHtml);


const targetHtml = `export function TargetsCard() {
  return (
    <div className="surface-card rounded-lg p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-slate-800">Today&apos;s Targets</h2>
      </div>
      <div className="mt-auto flex items-center gap-3">
        <div className="size-12 rounded-full border-[4px] border-slate-100 flex items-center justify-center relative">
          <div className="absolute inset-0 border-[4px] border-sky-500 rounded-full border-t-transparent border-r-transparent rotate-45"></div>
          <span className="text-[10px] font-bold text-slate-700">0%</span>
        </div>
        <div>
          <p className="text-[12px] font-bold text-slate-800">₹0 / ₹0</p>
          <p className="text-[9px] text-slate-400">Sales Target</p>
        </div>
        <div className="ml-auto text-[10px] font-semibold text-sky-600">
          View Targets &rarr;
        </div>
      </div>
    </div>
  );
}`;
c = c.replace(/export function TargetsCard([\s\S]*?)<\/div>\s+\);\s+}/, targetHtml);


fs.writeFileSync(f, c);
