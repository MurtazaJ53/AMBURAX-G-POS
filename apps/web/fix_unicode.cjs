const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");

content = content.replace(/\?""/g, '—');

fs.writeFileSync(file, content);
