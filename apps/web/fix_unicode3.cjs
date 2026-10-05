const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(/avgOrderValue !== null \? formatMinor\(avgOrderValue\) : [^}]+\}/, 'avgOrderValue !== null ? formatMinor(avgOrderValue) : "—"}');
content = content.replace(/detail\.phone \|\| [^}]+\}/, 'detail.phone || "—"}');
content = content.replace(/detail\.email \|\| [^}]+\}/, 'detail.email || "—"}');

fs.writeFileSync(file, content);
