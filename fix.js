const fs = require('fs');
let c1 = fs.readFileSync('apps/web/src/server/dashboard/dashboardTransforms.ts', 'utf8');

const start = c1.indexOf('export function formatAxisMoney');
const end = c1.indexOf('}', start) + 1;

const newFunc = `export function formatAxisMoney(minor: number): string {
  const major = Math.round(minor / 100);
  if (Math.abs(major) >= 10_000_000) return \`₹\${(major / 10_000_000).toFixed(1)}Cr\`;
  if (Math.abs(major) >= 100_000) return \`₹\${(major / 100_000).toFixed(1)}L\`;
  if (Math.abs(major) >= 1_000) return \`₹\${Math.round(major / 1_000)}K\`;
  return \`₹\${major}\`;
}`;

c1 = c1.substring(0, start) + newFunc + c1.substring(end);
fs.writeFileSync('apps/web/src/server/dashboard/dashboardTransforms.ts', c1, 'utf8');

let c2 = fs.readFileSync('apps/web/src/components/dashboard/SalesTrendCard.tsx', 'utf8');
const sStart = c2.indexOf('Sales (');
if (sStart !== -1) {
  const sEnd = c2.indexOf(')', sStart) + 1;
  c2 = c2.substring(0, sStart) + 'Sales (₹)' + c2.substring(sEnd);
  fs.writeFileSync('apps/web/src/components/dashboard/SalesTrendCard.tsx', c2, 'utf8');
}
