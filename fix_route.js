const fs = require("fs");
let content = fs.readFileSync("apps/web/src/app/api/v1/sales/route.ts", "utf-8");
content = content.replace(/message: \(result as any\)\.reason,/g, 'message: result.reason,');
fs.writeFileSync("apps/web/src/app/api/v1/sales/route.ts", content);
