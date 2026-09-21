import fs from 'fs';

const file = 'src/components/inventory/InventoryAnalytics.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add items-start to the grid
content = content.replace(
  /<div className="mt-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-\[1fr_0.95fr_1.45fr\]">/,
  '<div className="mt-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-[1fr_0.95fr_1.45fr] items-start">'
);

// 2. Add max-h to Recent Movements
content = content.replace(
  /<div className="flex-1 min-h-0 overflow-y-auto">/,
  '<div className="flex-1 min-h-0 overflow-y-auto max-h-[160px] pr-1">'
);

fs.writeFileSync(file, content, 'utf8');
