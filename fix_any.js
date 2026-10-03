const fs = require("fs");
let content = fs.readFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", "utf-8");
content = content.replace(/setMethod\(m\.value as any\);/g, 'setMethod(m.value as PaymentMethod | "SPLIT");');
fs.writeFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", content);
