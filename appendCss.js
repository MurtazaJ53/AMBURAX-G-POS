const fs = require('fs');
let css = fs.readFileSync('apps/web/src/app/globals.css', 'utf8');
const newCss = `
/* F3 Dashboard Custom Styles */
.surface-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  box-shadow: 0 2px 9px hsl(220 34% 24% / .035);
}
.surface-card:hover { box-shadow: 0 5px 18px hsl(220 34% 24% / .065); }
.data-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; letter-spacing: -0.035em; }

.dashboard-table th { padding: 0.5rem 0.5rem; text-align: left; font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.dashboard-table td { padding: 0.75rem 0.5rem; font-size: 11px; border-top: 1px solid #f1f5f9; }

.status-badge { display: inline-flex; align-items: center; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.status-paid { background: #ecfdf5; color: #059669; }
.status-pending { background: #fffbeb; color: #d97706; }
.status-low { background: #fffbeb; color: #d97706; }
.status-critical { background: #fef2f2; color: #dc2626; }
`;
if (!css.includes('.surface-card')) {
  fs.writeFileSync('apps/web/src/app/globals.css', css + '\n' + newCss);
}
