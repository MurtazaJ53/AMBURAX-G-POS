const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(/\{detail\.phone \|\| ".*?"\}/g, '{detail.phone || "—"}');
content = content.replace(/\{detail\.email \|\| ".*?"\}/g, '{detail.email || "—"}');
content = content.replace(/\{avgOrderValue !== null \? formatMinor\(avgOrderValue\) \: ".*?"\}/g, '{avgOrderValue !== null ? formatMinor(avgOrderValue) : "—"}');

fs.writeFileSync(file, content);
