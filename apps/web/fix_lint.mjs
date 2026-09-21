import fs from 'fs';

const panel = 'src/components/inventory/InventoryDetailPanel.tsx';
let pContent = fs.readFileSync(panel, 'utf8');
pContent = pContent.replace(
  /<p>Click "View Stock History" below to see all stock movements for this variant\.<\/p>/g,
  '<p>Click &quot;View Stock History&quot; below to see all stock movements for this variant.</p>'
);
fs.writeFileSync(panel, pContent);

const toolbar = 'src/components/inventory/InventoryToolbar.tsx';
let tContent = fs.readFileSync(toolbar, 'utf8');
tContent = tContent.replace(
  /<option value="Men's Wear">Men's Wear<\/option>/g,
  '<option value="Men\'s Wear">Men&apos;s Wear</option>'
);
tContent = tContent.replace(
  /<option value="Women's Wear">Women's Wear<\/option>/g,
  '<option value="Women\'s Wear">Women&apos;s Wear</option>'
);
fs.writeFileSync(toolbar, tContent);
