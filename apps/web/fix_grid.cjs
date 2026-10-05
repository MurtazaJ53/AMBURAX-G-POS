const fs = require("fs");
const file = "src/app/(app)/customers/CustomerDetailPanel.tsx";
let content = fs.readFileSync(file, "utf8");
content = content.replace(/sm:w-\[400px\]/, "sm:w-[360px]");
fs.writeFileSync(file, content);
