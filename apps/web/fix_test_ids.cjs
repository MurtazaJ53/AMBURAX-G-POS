const fs = require("fs");
let content = fs.readFileSync("src/test-integration/sales.test.ts", "utf-8");
content = content.replace(/COMMERCE_IDS\.tenantA\.variants\.variant1/g, "COMMERCE_IDS.variantA1");
fs.writeFileSync("src/test-integration/sales.test.ts", content);
