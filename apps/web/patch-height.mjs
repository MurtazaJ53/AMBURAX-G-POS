import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/pos/PosTerminal.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/h-\[calc\(100vh-64px\)\]/g, "flex-1 h-full min-h-0");

fs.writeFileSync(p, c);
console.log("Updated PosTerminal.tsx layout");
