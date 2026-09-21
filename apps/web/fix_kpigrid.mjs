import fs from 'fs';
let f = 'src/components/dashboard/KpiGrid.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/<div className="mt-3 flex items-end justify-between gap-2">/, '<div className="mt-2 flex items-center justify-start gap-2">');
c = c.replace(/<div className="surface-card rounded-lg p-4">/, '<div className="surface-card rounded-lg p-4 pb-3.5">');
c = c.replace(/<strong className="data-mono text-\[22px\] font-bold text-slate-900">/, '<strong className="data-mono text-[24px] font-bold tracking-tight text-slate-900">');
c = c.replace(/<span className={`flex items-center text-\[10px\] font-bold \${isNegative \? 'text-rose-600' : 'text-emerald-600'}`}>/, 
  `<span className={\`flex items-center text-[12px] font-bold \${isNegative ? 'text-rose-500' : 'text-emerald-500'}\`}>`);

c = c.replace(/label="Today's sales"/, 'label="TODAY\'S SALES"');
c = c.replace(/label="Bills"/, 'label="BILLS / TRANSACTIONS"');
c = c.replace(/label="Items sold"/, 'label="ITEMS SOLD"');
c = c.replace(/label="New customers"/, 'label="NEW CUSTOMERS"');
c = c.replace(/label="Stock counted"/, 'label="INVENTORY METRIC"');

fs.writeFileSync(f, c);
