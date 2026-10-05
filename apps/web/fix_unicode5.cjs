const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

const lines = content.split('\n');
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('avgOrderValue !== null')) {
    lines[i] = '              <b className="text-[13px] text-slate-900">{avgOrderValue !== null ? formatMinor(avgOrderValue) : "--"}</b>';
  }
  if (lines[i].includes('Phone:')) {
    lines[i] = '                  <p>Phone: <span className="text-slate-700">{detail.phone || "--"}</span></p>';
  }
  if (lines[i].includes('Email:')) {
    lines[i] = '                  <p>Email: <span className="text-slate-700">{detail.email || "--"}</span></p>';
  }
}
fs.writeFileSync(file, lines.join('\n'));
