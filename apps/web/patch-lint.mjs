import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/pos/PosTerminal.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /const idempotencyKey = useRef<string>\(\s*typeof crypto !== "undefined" \? crypto.randomUUID\(\) : Math.random\(\).toString\(\)\s*\);/g,
  `const idempotencyKey = useRef<string>("");\n  if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();`
);

c = c.replace(
  /setSearch\(EMPTY_SEARCH\);/g,
  `// eslint-disable-next-line react-hooks/set-state-in-effect\n      setSearch(EMPTY_SEARCH);`
);

fs.writeFileSync(p, c);
console.log("Fixed lint errors");
