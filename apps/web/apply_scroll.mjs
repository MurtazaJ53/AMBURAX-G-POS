import fs from 'fs';

// --- UPDATE PAGE.TSX ---
const pageFile = 'src/app/(app)/inventory/page.tsx';
let page = fs.readFileSync(pageFile, 'utf8');

// 1. Grid container
page = page.replace(
  /<div className=\{\`grid min-w-0 gap-4 \$\{selectedItem \? "xl:grid-cols-\[minmax\(0,1fr\)_380px\]" : "grid-cols-1"\}\`\}>/,
  '<div className={`grid min-w-0 min-h-0 gap-4 h-[calc(100dvh-340px)] min-h-[450px] ${selectedItem ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1"}`}>'
);

// 2. Table panel
page = page.replace(
  /<div className="min-w-0 overflow-hidden rounded-lg border border-border bg-background-card shadow-sm">/,
  '<div className="flex flex-col min-w-0 min-h-0 overflow-hidden rounded-lg border border-border bg-background-card shadow-sm">'
);

// 3. Table scroll container
page = page.replace(
  /<div className="overflow-x-auto">/,
  '<div className="flex-1 overflow-x-auto overflow-y-auto relative">'
);

// 4. Table header sticking
page = page.replace(
  /<thead className="bg-slate-50 text-\[10px\] uppercase tracking-wider text-secondary border-b border-border">/,
  '<thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-secondary sticky top-0 z-10 shadow-[0_1px_0_0_var(--border)]">'
);

fs.writeFileSync(pageFile, page, 'utf8');

// --- UPDATE INVENTORYDETAILPANEL.TSX ---
const panelFile = 'src/components/inventory/InventoryDetailPanel.tsx';
let panel = fs.readFileSync(panelFile, 'utf8');

// 1. Aside classes
panel = panel.replace(
  /<aside className="flex w-full xl:w-\[380px\] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background-card shadow-md xl:sticky xl:top-\[82px\] xl:self-start">/,
  '<aside className="flex h-full min-h-0 w-full xl:w-[380px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background-card shadow-md">'
);

// 2. Inner scroll container
panel = panel.replace(
  /<div className="flex-1 overflow-y-auto max-h-\[calc\(100dvh-180px\)\]">/,
  '<div className="flex-1 overflow-y-auto min-h-0">'
);

// 3. Footer shrink
panel = panel.replace(
  /<div className="mt-auto border-t border-border p-4 bg-slate-50 flex gap-2">/,
  '<div className="mt-auto border-t border-border p-4 bg-slate-50 flex gap-2 shrink-0">'
);

fs.writeFileSync(panelFile, panel, 'utf8');
