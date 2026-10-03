const fs = require("fs");
let content = fs.readFileSync("apps/web/src/server/sales/saleService.ts", "utf-8");
content = content.replace(/processedPayments\[0\]\?\.method \?\? SPLIT/g, 'processedPayments[0]?.method ?? "SPLIT"');
fs.writeFileSync("apps/web/src/server/sales/saleService.ts", content);
