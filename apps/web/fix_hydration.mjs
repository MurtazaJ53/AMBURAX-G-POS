import fs from 'fs';

const file = 'src/components/inventory/InventoryDetailPanel.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /<strong className="text-primary">\{item\.updatedAt\.toLocaleString\(\)\}<\/strong>/g;
const replacement = `<strong className="text-primary">{new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(item.updatedAt)}</strong>`;

content = content.replace(regex, replacement);

fs.writeFileSync(file, content, 'utf8');
