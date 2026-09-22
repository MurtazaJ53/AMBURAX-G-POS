import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/pos/PosTerminal.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /const idempotencyKey = useRef<string>\(""\);\n\s*if \(!idempotencyKey.current\) idempotencyKey.current = crypto.randomUUID\(\);/g,
  `const idempotencyKey = useRef<string>("");\n  if (idempotencyKey.current === "") {\n    idempotencyKey.current = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString();\n  }`
);

fs.writeFileSync(p, c);
console.log("Fixed lint errors 2");
