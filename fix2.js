const fs = require('fs');
let c1 = fs.readFileSync('apps/web/src/server/dashboard/dashboardTransforms.ts', 'utf8');

c1 = c1.replace(/export function formatAxisMoney\([\s\S]*?\n\}/, `export function formatAxisMoney(minor: number): string {
  const major = Math.round(minor / 100);
  if (Math.abs(major) >= 10_000_000) return \`₹\${(major / 10_000_000).toFixed(1)}Cr\`;
  if (Math.abs(major) >= 100_000) return \`₹\${(major / 100_000).toFixed(1)}L\`;
  if (Math.abs(major) >= 1_000) return \`₹\${Math.round(major / 1_000)}K\`;
  return \`₹\${major}\`;
}`);

fs.writeFileSync('apps/web/src/server/dashboard/dashboardTransforms.ts', c1, 'utf8');
